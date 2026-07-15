import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { constants as fsConstants, createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface FileInfo {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}

export type FileSortBy = 'name' | 'size' | 'modifiedAt' | 'type';
export type FileSortOrder = 'asc' | 'desc';

export interface FileListOptions {
  page?: number;
  pageSize?: number;
  keyword?: string;
  sortBy?: FileSortBy;
  sortOrder?: FileSortOrder;
}

export interface PaginatedFileList {
  items: FileInfo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BatchOperationItem {
  path: string;
  success: boolean;
  targetPath?: string;
  message?: string;
}

export interface BatchOperationResult {
  succeeded: number;
  failed: number;
  items: BatchOperationItem[];
}

export type PreviewKind =
  | 'image'
  | 'text'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'unsupported';

export interface PreviewDescriptor {
  token: string;
  url: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  kind: PreviewKind;
  expiresAt: string;
}

export interface PreviewTokenRecord extends Omit<PreviewDescriptor, 'url'> {
  absolutePath: string;
}

export interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  isDirectory: boolean;
  size: number;
  deletedAt: string;
}

export interface TrashListResult {
  items: TrashItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TrashListOptions {
  page?: number;
  pageSize?: number;
  keyword?: string;
  sortBy?: 'name' | 'size' | 'deletedAt';
  sortOrder?: FileSortOrder;
}

export interface StorageStats {
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  storageLimitBytes: number;
  recentFiles: Array<{
    name: string;
    path: string;
    size: number;
    modifiedAt: Date;
  }>;
}

interface UploadSession {
  id: string;
  ownerId: number;
  targetDir: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  fingerprint: string;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  createdAt: string;
  updatedAt: string;
}

interface ContentIndexEntry {
  hash: string;
  size: number;
  paths: Record<string, number>;
  updatedAt: string;
}

interface ContentIndexDocument {
  version: 1;
  entries: Record<string, ContentIndexEntry>;
}

interface UploadSessionResultBase {
  uploadedChunks: number[];
  expiresAt: string;
}

export interface ChunkedUploadSessionResult extends UploadSessionResultBase {
  instantUpload: false;
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  contentHash?: never;
  file?: never;
}

export interface InstantUploadSessionResult extends UploadSessionResultBase {
  instantUpload: true;
  contentHash: string;
  file: {
    name: string;
    path: string;
  };
  uploadId?: never;
  chunkSize?: never;
  totalChunks?: never;
}

export type UploadSessionResult =
  | ChunkedUploadSessionResult
  | InstantUploadSessionResult;

@Injectable()
export class FileService implements OnModuleInit, OnModuleDestroy {
  private readonly baseDir = path.resolve(
    process.env.FILE_STORAGE_DIR || path.join(process.cwd(), '../public_files'),
  );

  private readonly uploadRoot = path.resolve(
    process.env.UPLOAD_TEMP_DIR ||
      path.join(process.cwd(), '../data/upload_sessions'),
  );

  private readonly trashRoot = path.resolve(
    process.env.TRASH_DIR || path.join(process.cwd(), '../data/trash'),
  );

  private readonly contentIndexPath = path.resolve(
    process.env.CONTENT_INDEX_PATH ||
      path.join(process.cwd(), '../data/content-index.json'),
  );

  private readonly chunkSize = 5 * 1024 * 1024;
  private readonly maxUploadBytes = Number(
    process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024 * 1024,
  );
  private readonly storageLimitBytes = Number(
    process.env.STORAGE_LIMIT_BYTES || 100 * 1024 * 1024 * 1024,
  );
  private cleanupTimer?: NodeJS.Timeout;

  private readonly sessionTtlMs = Number(
    process.env.UPLOAD_SESSION_TTL_MS || 24 * 60 * 60 * 1000,
  );
  private readonly previewTokenTtlMs = Number(
    process.env.PREVIEW_TOKEN_TTL_MS || 15 * 60 * 1000,
  );
  private readonly previewTokens = new Map<string, PreviewTokenRecord>();
  private readonly contentIndex = new Map<string, ContentIndexEntry>();
  private contentIndexWrite = Promise.resolve();

  async onModuleInit(): Promise<void> {
    const trashRelativePath = path.relative(this.baseDir, this.trashRoot);
    if (
      trashRelativePath === '' ||
      (!trashRelativePath.startsWith('..') &&
        !path.isAbsolute(trashRelativePath))
    ) {
      throw new Error('TRASH_DIR 不能位于 FILE_STORAGE_DIR 内部');
    }
    await Promise.all([
      fs.mkdir(this.baseDir, { recursive: true }),
      fs.mkdir(this.uploadRoot, { recursive: true }),
      fs.mkdir(this.trashRoot, { recursive: true }),
      fs.mkdir(path.dirname(this.contentIndexPath), { recursive: true }),
    ]);
    await this.loadContentIndex();
    await this.cleanupExpiredUploadSessions();
    this.cleanupTimer = setInterval(
      () => {
        void this.cleanupExpiredUploadSessions();
        this.cleanupExpiredPreviewTokens();
      },
      Math.min(this.sessionTtlMs, this.previewTokenTtlMs, 60 * 60 * 1000),
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  public getSafePath(targetPath = '/'): string {
    const requestedPath = String(targetPath || '/').replace(/\\/g, '/');
    const segments = requestedPath.split('/').filter(Boolean);

    if (segments.includes('..')) {
      throw new BadRequestException('路径中不能包含上级目录标记');
    }

    const absolutePath = path.resolve(this.baseDir, ...segments);
    const relativePath = path.relative(this.baseDir, absolutePath);

    if (
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath) ||
      relativePath.includes(`..${path.sep}`)
    ) {
      throw new BadRequestException('非法的路径访问');
    }

    return absolutePath;
  }

  public normalizeVirtualPath(targetPath = '/'): string {
    const absolutePath = this.getSafePath(targetPath);
    const relativePath = path.relative(this.baseDir, absolutePath);
    return relativePath ? `/${relativePath.split(path.sep).join('/')}` : '/';
  }

  private sanitizeName(input: string): string {
    const name = String(input || '').trim();

    if (!name || name === '.' || name === '..') {
      throw new BadRequestException('名称不能为空');
    }
    if (name.length > 255) {
      throw new BadRequestException('名称不能超过 255 个字符');
    }
    if (
      /[/\\<>:"|?*]/.test(name) ||
      /[. ]$/.test(name) ||
      Array.from(name).some((character) => character.charCodeAt(0) <= 31)
    ) {
      throw new BadRequestException('名称包含不支持的字符');
    }

    return name;
  }

  private decodeUploadedName(originalName: string): string {
    if (!/[\u0080-\u00ff]/.test(originalName)) {
      return originalName;
    }

    const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? originalName : decoded;
  }

  async listFiles(
    dirPath: string,
    options: FileListOptions = {},
  ): Promise<PaginatedFileList> {
    const safePath = this.getSafePath(dirPath);
    const requestedPage = Math.max(1, Math.floor(Number(options.page) || 1));
    const pageSize = Math.min(
      200,
      Math.max(10, Math.floor(Number(options.pageSize) || 20)),
    );
    const keyword = String(options.keyword || '')
      .trim()
      .toLocaleLowerCase();
    const sortBy: FileSortBy = ['name', 'size', 'modifiedAt', 'type'].includes(
      options.sortBy || '',
    )
      ? (options.sortBy as FileSortBy)
      : 'name';
    const sortOrder: FileSortOrder =
      options.sortOrder === 'desc' ? 'desc' : 'asc';

    try {
      const items = await fs.readdir(safePath, { withFileTypes: true });
      const fileInfos = await Promise.all(
        items
          .filter((item) => !item.isSymbolicLink())
          .map(async (item): Promise<FileInfo | null> => {
            const itemPath = path.join(safePath, item.name);
            try {
              const stats = await fs.stat(itemPath);
              return {
                name: item.name,
                isDirectory: item.isDirectory(),
                size: item.isDirectory() ? 0 : stats.size,
                modifiedAt: stats.mtime,
              };
            } catch {
              return null;
            }
          }),
      );

      const filtered = fileInfos
        .filter((item): item is FileInfo => item !== null)
        .filter((item) =>
          keyword ? item.name.toLocaleLowerCase().includes(keyword) : true,
        )
        .sort((left, right) =>
          this.compareFileInfo(left, right, sortBy, sortOrder),
        );
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * pageSize;

      return {
        items: filtered.slice(offset, offset + pageSize),
        total,
        page,
        pageSize,
        totalPages,
      };
    } catch (error: unknown) {
      if (this.getErrorCode(error) === 'ENOENT') {
        throw new NotFoundException('目录不存在');
      }
      if (this.getErrorCode(error) === 'ENOTDIR') {
        throw new BadRequestException('目标路径不是目录');
      }
      throw error;
    }
  }

  async moveUploadedFile(
    file: Express.Multer.File,
    dirPath: string,
  ): Promise<string> {
    const safeDir = this.getSafePath(dirPath);
    const decodedName = this.decodeUploadedName(file.originalname);
    const safeName = this.sanitizeName(decodedName);
    await fs.mkdir(safeDir, { recursive: true });
    const targetPath = await this.resolveAvailablePath(safeDir, safeName);

    try {
      await fs.rename(file.path, targetPath);
    } catch (error: unknown) {
      if (this.getErrorCode(error) !== 'EXDEV') {
        await fs.rm(file.path, { force: true }).catch(() => undefined);
        throw error;
      }
      await fs.copyFile(file.path, targetPath);
      await fs.rm(file.path, { force: true });
    }

    return path.basename(targetPath);
  }

  async createFolder(dirPath: string, folderName: string): Promise<void> {
    const safeDir = this.getSafePath(dirPath);
    const cleanName = this.sanitizeName(folderName);
    const targetPath = path.join(safeDir, cleanName);

    try {
      await fs.mkdir(targetPath);
    } catch (error: unknown) {
      if (this.getErrorCode(error) === 'EEXIST') {
        throw new BadRequestException('同名文件夹已经存在');
      }
      if (this.getErrorCode(error) === 'ENOENT') {
        throw new NotFoundException('父目录不存在');
      }
      throw error;
    }
  }

  async renamePath(targetPath: string, newName: string): Promise<string> {
    const sourceVirtualPath = this.normalizeVirtualPath(targetPath);
    const sourcePath = this.getSafePath(sourceVirtualPath);
    const cleanName = this.sanitizeName(newName);
    const parentDir = path.dirname(sourcePath);
    const destinationPath = path.join(parentDir, cleanName);

    if (sourcePath === this.baseDir) {
      throw new BadRequestException('不能重命名根目录');
    }

    try {
      await fs.access(destinationPath);
      throw new BadRequestException('同名文件或目录已经存在');
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (this.getErrorCode(error) !== 'ENOENT') {
        throw error;
      }
    }

    try {
      await fs.rename(sourcePath, destinationPath);
      await this.updateContentIndexPaths(
        sourceVirtualPath,
        this.toVirtualPath(destinationPath),
      ).catch((error) => console.warn('Failed to update content index', error));
      return cleanName;
    } catch (error: unknown) {
      if (this.getErrorCode(error) === 'ENOENT') {
        throw new NotFoundException('文件或目录不存在');
      }
      throw error;
    }
  }

  async deletePath(targetPath: string, recursive = false): Promise<void> {
    const normalizedPath = this.normalizeVirtualPath(targetPath);
    const safePath = this.getSafePath(normalizedPath);
    if (safePath === this.baseDir) {
      throw new BadRequestException('不能删除根目录');
    }

    try {
      const stats = await fs.lstat(safePath);
      if (stats.isSymbolicLink()) {
        throw new BadRequestException('不允许操作符号链接');
      }
      if (stats.isDirectory()) {
        await fs.rm(safePath, { recursive, force: false });
      } else {
        await fs.unlink(safePath);
      }
      await this.removeContentIndexPaths(normalizedPath).catch((error) =>
        console.warn('Failed to update content index', error),
      );
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (this.getErrorCode(error) === 'ENOENT') {
        throw new NotFoundException('文件或目录不存在');
      }
      if (['ENOTEMPTY', 'EEXIST'].includes(this.getErrorCode(error) || '')) {
        throw new BadRequestException('目录不为空，请确认后执行递归删除');
      }
      throw error;
    }
  }

  async movePath(
    sourceVirtualPath: string,
    targetDirectoryPath: string,
  ): Promise<{ name: string; path: string }> {
    const normalizedSourcePath = this.normalizeVirtualPath(sourceVirtualPath);
    const sourcePath = this.getSafePath(normalizedSourcePath);
    const targetDirectory = this.getSafePath(targetDirectoryPath);

    if (sourcePath === this.baseDir) {
      throw new BadRequestException('不能移动根目录');
    }

    const [sourceStats, targetStats] = await Promise.all([
      fs.lstat(sourcePath).catch((error: unknown) => {
        if (this.getErrorCode(error) === 'ENOENT') {
          throw new NotFoundException('文件或目录不存在');
        }
        throw error;
      }),
      fs.lstat(targetDirectory).catch((error: unknown) => {
        if (this.getErrorCode(error) === 'ENOENT') {
          throw new NotFoundException('目标目录不存在');
        }
        throw error;
      }),
    ]);

    if (sourceStats.isSymbolicLink() || targetStats.isSymbolicLink()) {
      throw new BadRequestException('不允许移动符号链接');
    }
    if (!targetStats.isDirectory()) {
      throw new BadRequestException('移动目标必须是目录');
    }
    if (path.dirname(sourcePath) === targetDirectory) {
      throw new BadRequestException('目标目录与当前目录相同');
    }

    const relativeTarget = path.relative(sourcePath, targetDirectory);
    if (
      sourceStats.isDirectory() &&
      (relativeTarget === '' ||
        (!relativeTarget.startsWith('..') && !path.isAbsolute(relativeTarget)))
    ) {
      throw new BadRequestException('不能把目录移动到自身或其子目录中');
    }

    const destinationPath = await this.resolveAvailablePath(
      targetDirectory,
      path.basename(sourcePath),
    );

    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (error: unknown) {
      if (this.getErrorCode(error) !== 'EXDEV') throw error;
      if (sourceStats.isDirectory()) {
        await fs.cp(sourcePath, destinationPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
        await fs.rm(sourcePath, { recursive: true, force: false });
      } else {
        await fs.copyFile(sourcePath, destinationPath);
        await fs.unlink(sourcePath);
      }
    }

    const destinationVirtualPath = this.toVirtualPath(destinationPath);
    await this.updateContentIndexPaths(
      normalizedSourcePath,
      destinationVirtualPath,
    ).catch((error) => console.warn('Failed to update content index', error));
    return {
      name: path.basename(destinationPath),
      path: destinationVirtualPath,
    };
  }

  async deletePaths(
    targetPaths: string[],
    recursive = false,
  ): Promise<BatchOperationResult> {
    const paths = this.normalizeBatchPaths(targetPaths);
    const items: BatchOperationItem[] = [];

    for (const targetPath of paths) {
      try {
        await this.deletePath(targetPath, recursive);
        items.push({ path: targetPath, success: true });
      } catch (error) {
        items.push({
          path: targetPath,
          success: false,
          message: this.getErrorMessage(error),
        });
      }
    }

    return this.summarizeBatch(items);
  }

  async trashPath(targetPath: string): Promise<TrashItem> {
    const normalizedPath = this.normalizeVirtualPath(targetPath);
    const sourcePath = this.getSafePath(normalizedPath);
    if (sourcePath === this.baseDir) {
      throw new BadRequestException('不能将根目录移入回收站');
    }

    let stats;
    try {
      stats = await fs.lstat(sourcePath);
    } catch (error) {
      if (this.getErrorCode(error) === 'ENOENT') {
        throw new NotFoundException('文件或目录不存在');
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new BadRequestException('不允许回收符号链接');
    }

    const id = randomUUID();
    const itemDirectory = this.getTrashItemDirectory(id);
    const payloadPath = path.join(itemDirectory, 'payload');
    const item: TrashItem = {
      id,
      name: path.basename(sourcePath),
      originalPath: normalizedPath,
      isDirectory: stats.isDirectory(),
      size: stats.isDirectory() ? 0 : stats.size,
      deletedAt: new Date().toISOString(),
    };

    await fs.mkdir(itemDirectory, { recursive: false });
    try {
      await fs.writeFile(
        path.join(itemDirectory, 'manifest.json'),
        JSON.stringify(item, null, 2),
        'utf8',
      );
      await this.moveEntry(sourcePath, payloadPath, stats.isDirectory());
      await this.removeContentIndexPaths(normalizedPath).catch((error) =>
        console.warn('Failed to update content index', error),
      );
      return item;
    } catch (error) {
      await fs.rm(itemDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async trashPaths(targetPaths: string[]): Promise<BatchOperationResult> {
    const paths = this.normalizeBatchPaths(targetPaths);
    const items: BatchOperationItem[] = [];

    for (const targetPath of paths) {
      try {
        const trashed = await this.trashPath(targetPath);
        items.push({
          path: targetPath,
          targetPath: `/trash/${trashed.id}`,
          success: true,
        });
      } catch (error) {
        items.push({
          path: targetPath,
          success: false,
          message: this.getErrorMessage(error),
        });
      }
    }

    return this.summarizeBatch(items);
  }

  async listTrash(options: TrashListOptions = {}): Promise<TrashListResult> {
    const requestedPage = Math.max(1, Math.floor(Number(options.page) || 1));
    const pageSize = Math.min(
      100,
      Math.max(10, Math.floor(Number(options.pageSize) || 20)),
    );
    const keyword = String(options.keyword || '')
      .trim()
      .toLocaleLowerCase();
    const sortBy = options.sortBy || 'deletedAt';
    const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
    const directories = await fs.readdir(this.trashRoot, {
      withFileTypes: true,
    });
    const records = await Promise.all(
      directories
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readTrashItem(entry.name).catch(() => null)),
    );
    const items = records
      .filter((item): item is TrashItem => item !== null)
      .filter((item) =>
        keyword
          ? `${item.name} ${item.originalPath}`
              .toLocaleLowerCase()
              .includes(keyword)
          : true,
      )
      .sort((left, right) => {
        let result = 0;
        if (sortBy === 'size') result = left.size - right.size;
        else if (sortBy === 'name') {
          result = left.name.localeCompare(right.name, 'zh-CN', {
            numeric: true,
            sensitivity: 'base',
          });
        } else {
          result =
            new Date(left.deletedAt).getTime() -
            new Date(right.deletedAt).getTime();
        }
        return sortOrder === 'desc' ? -result : result;
      });
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;

    return {
      items: items.slice(offset, offset + pageSize),
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async restoreTrashItem(id: string): Promise<{ name: string; path: string }> {
    const item = await this.readTrashItem(id);
    const itemDirectory = this.getTrashItemDirectory(id);
    const payloadPath = path.join(itemDirectory, 'payload');
    const originalPath = this.getSafePath(item.originalPath);
    const targetDirectory = path.dirname(originalPath);
    await fs.mkdir(targetDirectory, { recursive: true });
    const destinationPath = await this.resolveAvailablePath(
      targetDirectory,
      item.name,
    );
    const stats = await fs.lstat(payloadPath);

    await this.moveEntry(payloadPath, destinationPath, stats.isDirectory());
    await fs.rm(itemDirectory, { recursive: true, force: true });
    if (stats.isFile()) {
      const hash = await this.calculateFileHash(destinationPath);
      await this.addContentIndexPath(
        hash,
        this.toVirtualPath(destinationPath),
        destinationPath,
      ).catch((error) => console.warn('Failed to update content index', error));
    }
    return {
      name: path.basename(destinationPath),
      path: this.toVirtualPath(destinationPath),
    };
  }

  async permanentlyDeleteTrashItem(id: string): Promise<void> {
    await this.readTrashItem(id);
    await fs.rm(this.getTrashItemDirectory(id), {
      recursive: true,
      force: false,
    });
  }

  async emptyTrash(): Promise<number> {
    const entries = await fs.readdir(this.trashRoot, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    await Promise.all(
      directories.map((entry) =>
        fs.rm(path.join(this.trashRoot, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
    );
    return directories.length;
  }

  async movePaths(
    sourcePaths: string[],
    targetDirectoryPath: string,
  ): Promise<BatchOperationResult> {
    const paths = this.normalizeBatchPaths(sourcePaths);
    const normalizedTarget = this.normalizeVirtualPath(targetDirectoryPath);
    const items: BatchOperationItem[] = [];

    for (const sourcePath of paths) {
      try {
        const moved = await this.movePath(sourcePath, normalizedTarget);
        items.push({
          path: sourcePath,
          targetPath: moved.path,
          success: true,
        });
      } catch (error) {
        items.push({
          path: sourcePath,
          success: false,
          message: this.getErrorMessage(error),
        });
      }
    }

    return this.summarizeBatch(items);
  }

  async assertDownloadable(targetPath: string): Promise<string> {
    const safePath = this.getSafePath(targetPath);
    try {
      const stats = await fs.lstat(safePath);
      if (stats.isSymbolicLink()) {
        throw new BadRequestException('不允许下载符号链接');
      }
      if (!stats.isFile()) {
        throw new BadRequestException('当前只支持下载单个文件');
      }
      return safePath;
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (this.getErrorCode(error) === 'ENOENT') {
        throw new NotFoundException('文件不存在');
      }
      throw error;
    }
  }

  async createPreviewToken(targetPath: string): Promise<PreviewDescriptor> {
    const normalizedPath = this.normalizeVirtualPath(targetPath);
    const absolutePath = await this.assertDownloadable(normalizedPath);
    const stats = await fs.stat(absolutePath);
    const name = path.basename(absolutePath);
    const { mimeType, kind } = this.getPreviewType(name);
    const token = randomUUID();
    const expiresAt = new Date(
      Date.now() + this.previewTokenTtlMs,
    ).toISOString();
    const record: PreviewTokenRecord = {
      token,
      absolutePath,
      name,
      path: normalizedPath,
      size: stats.size,
      mimeType,
      kind,
      expiresAt,
    };
    this.previewTokens.set(token, record);

    return {
      token,
      url: `/api/files/preview/${token}`,
      name,
      path: normalizedPath,
      size: stats.size,
      mimeType,
      kind,
      expiresAt,
    };
  }

  async resolvePreviewToken(token: string): Promise<PreviewTokenRecord> {
    if (!/^[a-f\d-]{36}$/i.test(token)) {
      throw new BadRequestException('预览令牌无效');
    }
    const record = this.previewTokens.get(token);
    if (!record) throw new NotFoundException('预览令牌不存在或已失效');
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      this.previewTokens.delete(token);
      throw new NotFoundException('预览令牌已经过期');
    }
    const stats = await fs.lstat(record.absolutePath).catch(() => null);
    if (!stats?.isFile()) {
      this.previewTokens.delete(token);
      throw new NotFoundException('预览文件已经不存在');
    }
    record.size = stats.size;
    record.expiresAt = new Date(
      Date.now() + this.previewTokenTtlMs,
    ).toISOString();
    return record;
  }

  async initializeUpload(input: {
    ownerId: number;
    targetDir: string;
    fileName: string;
    fileSize: number;
    lastModified: number;
    resumeId?: string;
    contentHash?: string;
  }): Promise<UploadSessionResult> {
    const targetDir = this.normalizeVirtualPath(input.targetDir);
    const fileName = this.sanitizeName(input.fileName);
    const fileSize = Number(input.fileSize);
    const lastModified = Number(input.lastModified || 0);

    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new BadRequestException('文件大小无效');
    }
    if (fileSize > this.maxUploadBytes) {
      throw new BadRequestException(
        `文件超过上传上限 ${this.formatBytes(this.maxUploadBytes)}`,
      );
    }

    const contentHash = input.contentHash?.trim().toLowerCase();
    if (contentHash && !/^[a-f\d]{64}$/.test(contentHash)) {
      throw new BadRequestException('SHA-256 内容哈希格式无效');
    }
    if (contentHash) {
      const instantFile = await this.tryInstantUpload(
        contentHash,
        fileSize,
        targetDir,
        fileName,
      );
      if (instantFile) {
        return {
          instantUpload: true,
          uploadedChunks: [],
          expiresAt: new Date().toISOString(),
          contentHash,
          file: instantFile,
        };
      }
    }

    const fingerprint = this.createFingerprint(
      input.ownerId,
      targetDir,
      fileName,
      fileSize,
      lastModified,
    );

    if (input.resumeId) {
      const existing = await this.loadSession(input.resumeId).catch(() => null);
      if (
        existing &&
        existing.ownerId === input.ownerId &&
        existing.fingerprint === fingerprint
      ) {
        return this.toSessionResult(existing);
      }
    }

    const now = new Date().toISOString();
    const session: UploadSession = {
      id: randomUUID(),
      ownerId: input.ownerId,
      targetDir,
      fileName,
      fileSize,
      lastModified,
      fingerprint,
      chunkSize: this.chunkSize,
      totalChunks: Math.max(1, Math.ceil(fileSize / this.chunkSize)),
      uploadedChunks: [],
      createdAt: now,
      updatedAt: now,
    };

    await fs.mkdir(this.getSessionDir(session.id), { recursive: true });
    await this.saveSession(session);
    return this.toSessionResult(session);
  }

  async getUploadStatus(
    uploadId: string,
    ownerId: number,
  ): Promise<UploadSessionResult> {
    const session = await this.loadOwnedSession(uploadId, ownerId);
    return this.toSessionResult(session);
  }

  async saveUploadChunk(
    uploadId: string,
    ownerId: number,
    chunkIndex: number,
    chunk: Express.Multer.File,
  ): Promise<UploadSessionResult> {
    const session = await this.loadOwnedSession(uploadId, ownerId);

    if (
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex >= session.totalChunks
    ) {
      await fs.rm(chunk.path, { force: true }).catch(() => undefined);
      throw new BadRequestException('分片序号无效');
    }

    const expectedSize = this.getExpectedChunkSize(session, chunkIndex);
    if (chunk.size !== expectedSize) {
      await fs.rm(chunk.path, { force: true }).catch(() => undefined);
      throw new BadRequestException(
        `分片大小不匹配，期望 ${expectedSize} 字节，实际 ${chunk.size} 字节`,
      );
    }

    const chunkPath = this.getChunkPath(uploadId, chunkIndex);
    await fs.rm(chunkPath, { force: true });
    try {
      await fs.rename(chunk.path, chunkPath);
    } catch (error: unknown) {
      if (this.getErrorCode(error) !== 'EXDEV') {
        await fs.rm(chunk.path, { force: true }).catch(() => undefined);
        throw error;
      }
      await fs.copyFile(chunk.path, chunkPath);
      await fs.rm(chunk.path, { force: true });
    }

    session.uploadedChunks = Array.from(
      new Set([...session.uploadedChunks, chunkIndex]),
    ).sort((a, b) => a - b);
    session.updatedAt = new Date().toISOString();
    await this.saveSession(session);
    return this.toSessionResult(session);
  }

  async completeUpload(
    uploadId: string,
    ownerId: number,
  ): Promise<{ name: string; path: string; contentHash: string }> {
    const session = await this.loadOwnedSession(uploadId, ownerId);
    const uploaded = new Set(session.uploadedChunks);

    for (let index = 0; index < session.totalChunks; index += 1) {
      if (!uploaded.has(index)) {
        throw new BadRequestException('上传尚未完成，仍有分片缺失');
      }
    }

    const safeDir = this.getSafePath(session.targetDir);
    await fs.mkdir(safeDir, { recursive: true });
    const targetPath = await this.resolveAvailablePath(
      safeDir,
      session.fileName,
    );
    const temporaryTarget = `${targetPath}.uploading-${uploadId}`;
    const handle = await fs.open(temporaryTarget, 'wx');
    const contentHasher = createHash('sha256');

    try {
      for (let index = 0; index < session.totalChunks; index += 1) {
        const data = await fs.readFile(this.getChunkPath(uploadId, index));
        contentHasher.update(data);
        await handle.write(data);
      }
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.rm(temporaryTarget, { force: true }).catch(() => undefined);
      throw error;
    }

    await handle.close();
    await fs.rename(temporaryTarget, targetPath);
    await fs.rm(this.getSessionDir(uploadId), { recursive: true, force: true });

    const name = path.basename(targetPath);
    const virtualPath =
      session.targetDir === '/' ? `/${name}` : `${session.targetDir}/${name}`;
    const contentHash = contentHasher.digest('hex');
    await this.addContentIndexPath(contentHash, virtualPath, targetPath).catch(
      (error) => console.warn('Failed to persist content index', error),
    );
    return {
      name,
      path: virtualPath,
      contentHash,
    };
  }

  async cancelUpload(uploadId: string, ownerId: number): Promise<void> {
    await this.loadOwnedSession(uploadId, ownerId);
    await fs.rm(this.getSessionDir(uploadId), { recursive: true, force: true });
  }

  async getStorageStats(): Promise<StorageStats> {
    let totalFiles = 0;
    let totalFolders = 0;
    let totalBytes = 0;
    const recentFiles: StorageStats['recentFiles'] = [];

    const scanDir = async (dir: string): Promise<void> => {
      const items = await fs
        .readdir(dir, { withFileTypes: true })
        .catch(() => []);
      for (const item of items) {
        if (item.isSymbolicLink()) continue;
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          totalFolders += 1;
          await scanDir(fullPath);
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);
          totalFiles += 1;
          totalBytes += stats.size;
          recentFiles.push({
            name: item.name,
            path: `/${path.relative(this.baseDir, fullPath).split(path.sep).join('/')}`,
            size: stats.size,
            modifiedAt: stats.mtime,
          });
        } catch {
          // Ignore files that disappear while the directory is being scanned.
        }
      }
    };

    await scanDir(this.baseDir);
    recentFiles.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    return {
      totalFiles,
      totalFolders,
      totalBytes,
      storageLimitBytes: this.storageLimitBytes,
      recentFiles: recentFiles.slice(0, 6),
    };
  }

  private compareFileInfo(
    left: FileInfo,
    right: FileInfo,
    sortBy: FileSortBy,
    sortOrder: FileSortOrder,
  ): number {
    if (left.isDirectory !== right.isDirectory)
      return left.isDirectory ? -1 : 1;

    let result = 0;
    if (sortBy === 'size') result = left.size - right.size;
    else if (sortBy === 'modifiedAt') {
      result = left.modifiedAt.getTime() - right.modifiedAt.getTime();
    } else if (sortBy === 'type') {
      result = path
        .extname(left.name)
        .localeCompare(path.extname(right.name), 'zh-CN');
    } else {
      result = left.name.localeCompare(right.name, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      });
    }

    if (result === 0 && sortBy !== 'name') {
      result = left.name.localeCompare(right.name, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      });
    }
    return sortOrder === 'desc' ? -result : result;
  }

  private normalizeBatchPaths(targetPaths: string[]): string[] {
    if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
      throw new BadRequestException('请至少选择一个文件或目录');
    }
    const uniquePaths = Array.from(
      new Set(
        targetPaths.map((item) => this.normalizeVirtualPath(String(item))),
      ),
    );
    if (uniquePaths.length > 100) {
      throw new BadRequestException('单次批量操作最多处理 100 个对象');
    }
    if (uniquePaths.includes('/')) {
      throw new BadRequestException('批量操作不能包含根目录');
    }
    return uniquePaths;
  }

  private summarizeBatch(items: BatchOperationItem[]): BatchOperationResult {
    const succeeded = items.filter((item) => item.success).length;
    return { succeeded, failed: items.length - succeeded, items };
  }

  private toVirtualPath(absolutePath: string): string {
    const relativePath = path.relative(this.baseDir, absolutePath);
    return relativePath ? `/${relativePath.split(path.sep).join('/')}` : '/';
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '操作失败';
  }

  private async loadContentIndex(): Promise<void> {
    try {
      const document = JSON.parse(
        await fs.readFile(this.contentIndexPath, 'utf8'),
      ) as ContentIndexDocument;
      if (document.version !== 1 || !document.entries) return;
      for (const [hash, entry] of Object.entries(document.entries)) {
        if (
          /^[a-f\d]{64}$/.test(hash) &&
          entry.hash === hash &&
          Number.isSafeInteger(entry.size) &&
          entry.paths &&
          typeof entry.paths === 'object'
        ) {
          this.contentIndex.set(hash, entry);
        }
      }
    } catch (error) {
      if (this.getErrorCode(error) !== 'ENOENT') {
        console.warn('Failed to load content index', error);
      }
    }
  }

  private persistContentIndex(): Promise<void> {
    const document: ContentIndexDocument = {
      version: 1,
      entries: Object.fromEntries(this.contentIndex),
    };
    const serialized = JSON.stringify(document, null, 2);
    this.contentIndexWrite = this.contentIndexWrite
      .catch(() => undefined)
      .then(async () => {
        const temporaryPath = `${this.contentIndexPath}.tmp`;
        await fs.writeFile(temporaryPath, serialized, 'utf8');
        await fs.rename(temporaryPath, this.contentIndexPath);
      });
    return this.contentIndexWrite;
  }

  private async addContentIndexPath(
    hash: string,
    virtualPath: string,
    absolutePath: string,
  ): Promise<void> {
    const stats = await fs.stat(absolutePath);
    const entry = this.contentIndex.get(hash) || {
      hash,
      size: stats.size,
      paths: {},
      updatedAt: new Date().toISOString(),
    };
    entry.size = stats.size;
    entry.paths[virtualPath] = stats.mtimeMs;
    entry.updatedAt = new Date().toISOString();
    this.contentIndex.set(hash, entry);
    await this.persistContentIndex();
  }

  private async tryInstantUpload(
    hash: string,
    fileSize: number,
    targetDirectoryPath: string,
    fileName: string,
  ): Promise<{ name: string; path: string } | null> {
    const entry = this.contentIndex.get(hash);
    if (!entry || entry.size !== fileSize) return null;

    let indexChanged = false;
    for (const [sourceVirtualPath, indexedModifiedAt] of Object.entries(
      entry.paths,
    )) {
      try {
        const sourcePath = this.getSafePath(sourceVirtualPath);
        const stats = await fs.stat(sourcePath);
        if (
          !stats.isFile() ||
          stats.size !== fileSize ||
          Math.abs(stats.mtimeMs - indexedModifiedAt) > 1
        ) {
          delete entry.paths[sourceVirtualPath];
          indexChanged = true;
          continue;
        }

        const targetDirectory = this.getSafePath(targetDirectoryPath);
        await fs.mkdir(targetDirectory, { recursive: true });
        const targetPath = await this.resolveAvailablePath(
          targetDirectory,
          fileName,
        );
        await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_FICLONE);
        const name = path.basename(targetPath);
        const virtualPath = this.toVirtualPath(targetPath);
        await this.addContentIndexPath(hash, virtualPath, targetPath);
        return { name, path: virtualPath };
      } catch (error) {
        if (this.getErrorCode(error) === 'ENOENT') {
          delete entry.paths[sourceVirtualPath];
          indexChanged = true;
          continue;
        }
        throw error;
      }
    }

    if (Object.keys(entry.paths).length === 0) this.contentIndex.delete(hash);
    if (indexChanged) await this.persistContentIndex();
    return null;
  }

  private async removeContentIndexPaths(pathPrefix: string): Promise<void> {
    let changed = false;
    const descendantPrefix = `${pathPrefix.replace(/\/$/, '')}/`;
    for (const [hash, entry] of this.contentIndex) {
      for (const indexedPath of Object.keys(entry.paths)) {
        if (
          indexedPath === pathPrefix ||
          indexedPath.startsWith(descendantPrefix)
        ) {
          delete entry.paths[indexedPath];
          changed = true;
        }
      }
      if (Object.keys(entry.paths).length === 0) this.contentIndex.delete(hash);
    }
    if (changed) await this.persistContentIndex();
  }

  private async updateContentIndexPaths(
    sourcePrefix: string,
    destinationPrefix: string,
  ): Promise<void> {
    let changed = false;
    const descendantPrefix = `${sourcePrefix.replace(/\/$/, '')}/`;
    for (const entry of this.contentIndex.values()) {
      for (const [indexedPath, modifiedAt] of Object.entries(entry.paths)) {
        if (
          indexedPath === sourcePrefix ||
          indexedPath.startsWith(descendantPrefix)
        ) {
          const suffix = indexedPath.slice(sourcePrefix.length);
          delete entry.paths[indexedPath];
          entry.paths[`${destinationPrefix}${suffix}`] = modifiedAt;
          entry.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
    }
    if (changed) await this.persistContentIndex();
  }

  private async calculateFileHash(absolutePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(absolutePath)) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  private async moveEntry(
    sourcePath: string,
    destinationPath: string,
    isDirectory: boolean,
  ): Promise<void> {
    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (error) {
      if (this.getErrorCode(error) !== 'EXDEV') throw error;
      if (isDirectory) {
        await fs.cp(sourcePath, destinationPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
        await fs.rm(sourcePath, { recursive: true, force: false });
      } else {
        await fs.copyFile(sourcePath, destinationPath);
        await fs.unlink(sourcePath);
      }
    }
  }

  private getTrashItemDirectory(id: string): string {
    if (!/^[a-f\d-]{36}$/i.test(id)) {
      throw new BadRequestException('回收站对象 ID 无效');
    }
    return path.join(this.trashRoot, id);
  }

  private async readTrashItem(id: string): Promise<TrashItem> {
    const itemDirectory = this.getTrashItemDirectory(id);
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(itemDirectory, 'manifest.json'), 'utf8'),
      ) as TrashItem;
      if (
        manifest.id !== id ||
        !manifest.name ||
        !manifest.originalPath ||
        !manifest.deletedAt
      ) {
        throw new Error('Invalid trash manifest');
      }
      await fs.access(path.join(itemDirectory, 'payload'));
      return manifest;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new NotFoundException('回收站对象不存在或元数据已损坏');
    }
  }

  private getPreviewType(name: string): {
    mimeType: string;
    kind: PreviewKind;
  } {
    const extension = path.extname(name).toLocaleLowerCase();
    const imageTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };
    const audioTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
    };
    const videoTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogv': 'video/ogg',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
    };
    const textTypes: Record<string, string> = {
      '.txt': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
      '.log': 'text/plain; charset=utf-8',
      '.xml': 'application/xml; charset=utf-8',
      '.html': 'text/plain; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.ts': 'text/plain; charset=utf-8',
      '.vue': 'text/plain; charset=utf-8',
      '.py': 'text/plain; charset=utf-8',
      '.java': 'text/plain; charset=utf-8',
      '.yml': 'text/plain; charset=utf-8',
      '.yaml': 'text/plain; charset=utf-8',
      '.ini': 'text/plain; charset=utf-8',
      '.conf': 'text/plain; charset=utf-8',
      '.sql': 'text/plain; charset=utf-8',
    };

    if (imageTypes[extension]) {
      return { mimeType: imageTypes[extension], kind: 'image' };
    }
    if (audioTypes[extension]) {
      return { mimeType: audioTypes[extension], kind: 'audio' };
    }
    if (videoTypes[extension]) {
      return { mimeType: videoTypes[extension], kind: 'video' };
    }
    if (textTypes[extension]) {
      return { mimeType: textTypes[extension], kind: 'text' };
    }
    if (extension === '.pdf') {
      return { mimeType: 'application/pdf', kind: 'pdf' };
    }
    return { mimeType: 'application/octet-stream', kind: 'unsupported' };
  }

  private cleanupExpiredPreviewTokens(): void {
    const now = Date.now();
    for (const [token, record] of this.previewTokens) {
      if (new Date(record.expiresAt).getTime() <= now) {
        this.previewTokens.delete(token);
      }
    }
  }

  private createFingerprint(
    ownerId: number,
    targetDir: string,
    fileName: string,
    fileSize: number,
    lastModified: number,
  ): string {
    return createHash('sha256')
      .update(`${ownerId}|${targetDir}|${fileName}|${fileSize}|${lastModified}`)
      .digest('hex');
  }

  private getExpectedChunkSize(
    session: UploadSession,
    chunkIndex: number,
  ): number {
    if (session.fileSize === 0) return 0;
    const start = chunkIndex * session.chunkSize;
    return Math.min(session.chunkSize, session.fileSize - start);
  }

  private getSessionDir(uploadId: string): string {
    if (!/^[a-f\d-]{36}$/i.test(uploadId)) {
      throw new BadRequestException('上传会话 ID 无效');
    }
    return path.join(this.uploadRoot, uploadId);
  }

  private getManifestPath(uploadId: string): string {
    return path.join(this.getSessionDir(uploadId), 'manifest.json');
  }

  private getChunkPath(uploadId: string, index: number): string {
    return path.join(this.getSessionDir(uploadId), `${index}.part`);
  }

  private async loadSession(uploadId: string): Promise<UploadSession> {
    try {
      const content = await fs.readFile(this.getManifestPath(uploadId), 'utf8');
      const session = JSON.parse(content) as UploadSession;
      const expiresAt =
        new Date(session.updatedAt).getTime() + this.sessionTtlMs;
      if (expiresAt < Date.now()) {
        await fs.rm(this.getSessionDir(uploadId), {
          recursive: true,
          force: true,
        });
        throw new NotFoundException('上传会话已过期');
      }
      const validChunks: number[] = [];
      for (const index of session.uploadedChunks) {
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= session.totalChunks
        ) {
          continue;
        }
        const stats = await fs
          .stat(this.getChunkPath(uploadId, index))
          .catch(() => null);
        if (stats?.size === this.getExpectedChunkSize(session, index)) {
          validChunks.push(index);
        }
      }
      if (validChunks.length !== session.uploadedChunks.length) {
        session.uploadedChunks = validChunks;
        session.updatedAt = new Date().toISOString();
        await this.saveSession(session);
      }
      return session;
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      if (
        this.getErrorCode(error) === 'ENOENT' ||
        error instanceof SyntaxError
      ) {
        throw new NotFoundException('上传会话不存在');
      }
      throw error;
    }
  }

  private async loadOwnedSession(
    uploadId: string,
    ownerId: number,
  ): Promise<UploadSession> {
    const session = await this.loadSession(uploadId);
    if (session.ownerId !== ownerId) {
      throw new NotFoundException('上传会话不存在');
    }
    return session;
  }

  private async saveSession(session: UploadSession): Promise<void> {
    const manifestPath = this.getManifestPath(session.id);
    const temporaryPath = `${manifestPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(session, null, 2), 'utf8');
    await fs.rename(temporaryPath, manifestPath);
  }

  private toSessionResult(session: UploadSession): UploadSessionResult {
    return {
      instantUpload: false,
      uploadId: session.id,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedChunks: session.uploadedChunks,
      expiresAt: new Date(
        new Date(session.updatedAt).getTime() + this.sessionTtlMs,
      ).toISOString(),
    };
  }

  private async resolveAvailablePath(
    directory: string,
    requestedName: string,
  ): Promise<string> {
    const extension = path.extname(requestedName);
    const baseName = path.basename(requestedName, extension);

    for (let suffix = 0; suffix < 10_000; suffix += 1) {
      const candidateName =
        suffix === 0 ? requestedName : `${baseName} (${suffix})${extension}`;
      const candidatePath = path.join(directory, candidateName);
      try {
        await fs.access(candidatePath);
      } catch (error: unknown) {
        if (this.getErrorCode(error) === 'ENOENT') return candidatePath;
        throw error;
      }
    }

    throw new BadRequestException('无法为重名文件分配新名称');
  }

  private async cleanupExpiredUploadSessions(): Promise<void> {
    const entries = await fs
      .readdir(this.uploadRoot, { withFileTypes: true })
      .catch(() => []);

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const sessionDir = path.join(this.uploadRoot, entry.name);
          try {
            const manifest = JSON.parse(
              await fs.readFile(path.join(sessionDir, 'manifest.json'), 'utf8'),
            ) as UploadSession;
            if (
              new Date(manifest.updatedAt).getTime() + this.sessionTtlMs <
              Date.now()
            ) {
              await fs.rm(sessionDir, { recursive: true, force: true });
            }
          } catch {
            const stats = await fs.stat(sessionDir).catch(() => null);
            if (
              stats &&
              stats.mtime.getTime() + this.sessionTtlMs < Date.now()
            ) {
              await fs.rm(sessionDir, { recursive: true, force: true });
            }
          }
        }),
    );
  }

  private getErrorCode(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      return (error as { code: string }).code;
    }
    return undefined;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1024; index += 1) {
      value /= 1024;
      unit = units[index];
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
  }
}
