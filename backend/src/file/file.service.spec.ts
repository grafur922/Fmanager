import * as fs from 'fs/promises';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FileService } from './file.service';

describe('FileService', () => {
  const workspace = path.join(
    process.env.TEMP || 'C:\\tmp',
    `filehub-service-${Date.now()}`,
  );
  const archiveFirstChunkSize = 5 * 1024 * 1024;
  const archiveSecondChunkSize = 1024 * 1024;
  const archiveTotalSize = archiveFirstChunkSize + archiveSecondChunkSize;
  let service: FileService;
  let archiveContentHash = '';

  beforeAll(async () => {
    process.env.FILE_STORAGE_DIR = path.join(workspace, 'storage');
    process.env.UPLOAD_TEMP_DIR = path.join(workspace, 'uploads');
    process.env.TRASH_DIR = path.join(workspace, 'trash');
    process.env.CONTENT_INDEX_PATH = path.join(workspace, 'content-index.json');
    service = new FileService();
    await service.onModuleInit();
  });

  afterAll(async () => {
    service.onModuleDestroy();
    await fs.rm(workspace, { recursive: true, force: true });
    delete process.env.FILE_STORAGE_DIR;
    delete process.env.UPLOAD_TEMP_DIR;
    delete process.env.TRASH_DIR;
    delete process.env.CONTENT_INDEX_PATH;
  });

  it('rejects parent-directory traversal', () => {
    expect(() => service.getSafePath('/../outside')).toThrow(
      BadRequestException,
    );
  });

  it('rejects malformed SHA-256 upload hashes', async () => {
    await expect(
      service.initializeUpload({
        ownerId: 7,
        targetDir: '/',
        fileName: 'invalid-hash.txt',
        fileSize: 1,
        lastModified: 1,
        contentHash: 'not-a-sha256-hash',
      }),
    ).rejects.toThrow('SHA-256 内容哈希格式无效');
  });

  it('creates and lists a folder', async () => {
    await service.createFolder('/', 'documents');
    await expect(service.listFiles('/')).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        items: [
          expect.objectContaining({ name: 'documents', isDirectory: true }),
        ],
      }),
    );
  });

  it('supports server-side search, sorting and pagination', async () => {
    const storage = path.join(workspace, 'storage');
    await Promise.all([
      fs.writeFile(path.join(storage, 'alpha.txt'), 'alpha'),
      fs.writeFile(path.join(storage, 'beta.txt'), 'beta'),
      fs.writeFile(path.join(storage, 'gamma.log'), 'gamma'),
    ]);

    const result = await service.listFiles('/', {
      keyword: '.txt',
      sortBy: 'name',
      sortOrder: 'desc',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.name)).toEqual([
      'beta.txt',
      'alpha.txt',
    ]);
  });

  it('resumes uploaded chunks and completes the file', async () => {
    const firstChunk = Buffer.alloc(archiveFirstChunkSize, 1);
    const secondChunk = Buffer.alloc(archiveSecondChunkSize, 2);
    archiveContentHash = createHash('sha256')
      .update(firstChunk)
      .update(secondChunk)
      .digest('hex');

    const session = await service.initializeUpload({
      ownerId: 7,
      targetDir: '/documents',
      fileName: 'archive.bin',
      fileSize: archiveTotalSize,
      lastModified: 123,
    });
    expect(session.instantUpload).toBe(false);
    if (session.instantUpload)
      throw new Error('Expected a chunked upload session');

    const firstPath = path.join(workspace, 'first.part');
    await fs.writeFile(firstPath, firstChunk);
    await service.saveUploadChunk(
      session.uploadId,
      7,
      0,
      multerFile(firstPath, firstChunk.length),
    );

    await expect(
      service.initializeUpload({
        ownerId: 7,
        targetDir: '/documents',
        fileName: 'archive.bin',
        fileSize: archiveTotalSize,
        lastModified: 123,
        resumeId: session.uploadId,
      }),
    ).resolves.toEqual(expect.objectContaining({ uploadedChunks: [0] }));

    const secondPath = path.join(workspace, 'second.part');
    await fs.writeFile(secondPath, secondChunk);
    await service.saveUploadChunk(
      session.uploadId,
      7,
      1,
      multerFile(secondPath, secondChunk.length),
    );

    const result = await service.completeUpload(session.uploadId, 7);
    expect(result).toEqual({
      name: 'archive.bin',
      path: '/documents/archive.bin',
      contentHash: archiveContentHash,
    });

    const finalPath = path.join(
      workspace,
      'storage',
      'documents',
      'archive.bin',
    );
    const stats = await fs.stat(finalPath);
    const content = await fs.readFile(finalPath);
    expect(stats.size).toBe(archiveTotalSize);
    expect(content[0]).toBe(1);
    expect(content[firstChunk.length]).toBe(2);
  });

  it('reloads the content index and completes duplicate content instantly', async () => {
    service.onModuleDestroy();
    service = new FileService();
    await service.onModuleInit();

    const session = await service.initializeUpload({
      ownerId: 7,
      targetDir: '/duplicates',
      fileName: 'archive-copy.bin',
      fileSize: archiveTotalSize,
      lastModified: 456,
      contentHash: archiveContentHash,
    });

    expect(session).toEqual(
      expect.objectContaining({
        instantUpload: true,
        contentHash: archiveContentHash,
        uploadedChunks: [],
        file: {
          name: 'archive-copy.bin',
          path: '/duplicates/archive-copy.bin',
        },
      }),
    );
    if (!session.instantUpload)
      throw new Error('Expected an instant upload result');
    expect(session.uploadId).toBeUndefined();

    const copiedContent = await fs.readFile(
      path.join(workspace, 'storage', 'duplicates', 'archive-copy.bin'),
    );
    expect(createHash('sha256').update(copiedContent).digest('hex')).toBe(
      archiveContentHash,
    );
  });

  it('invalidates stale content index paths before trying an instant upload', async () => {
    const originalContent = Buffer.from('indexed-version-a');
    const replacementContent = Buffer.from('indexed-version-b');
    const sourceSession = await service.initializeUpload({
      ownerId: 7,
      targetDir: '/documents',
      fileName: 'stale-source.bin',
      fileSize: originalContent.length,
      lastModified: 789,
    });
    if (sourceSession.instantUpload)
      throw new Error('Expected a chunked upload session');

    const chunkPath = path.join(workspace, 'stale.part');
    await fs.writeFile(chunkPath, originalContent);
    await service.saveUploadChunk(
      sourceSession.uploadId,
      7,
      0,
      multerFile(chunkPath, originalContent.length),
    );
    const completed = await service.completeUpload(sourceSession.uploadId, 7);

    const indexedPath = path.join(
      workspace,
      'storage',
      'documents',
      'stale-source.bin',
    );
    const indexedStats = await fs.stat(indexedPath);
    await fs.writeFile(indexedPath, replacementContent);
    await fs.utimes(
      indexedPath,
      indexedStats.atime,
      new Date(indexedStats.mtimeMs + 5000),
    );

    const fallbackSession = await service.initializeUpload({
      ownerId: 7,
      targetDir: '/documents',
      fileName: 'stale-copy.bin',
      fileSize: originalContent.length,
      lastModified: 790,
      contentHash: completed.contentHash,
    });

    expect(fallbackSession.instantUpload).toBe(false);
    if (fallbackSession.instantUpload) {
      throw new Error('Expected stale index lookup to fall back to chunks');
    }
    await service.cancelUpload(fallbackSession.uploadId, 7);
    await expect(
      fs.access(path.join(workspace, 'storage', 'documents', 'stale-copy.bin')),
    ).rejects.toBeDefined();
  });

  it('moves and deletes multiple objects with per-item results', async () => {
    await service.createFolder('/', 'archive');
    const moveResult = await service.movePaths(
      ['/documents/archive.bin', '/missing.txt'],
      '/archive',
    );

    expect(moveResult.succeeded).toBe(1);
    expect(moveResult.failed).toBe(1);
    await expect(service.listFiles('/archive')).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ name: 'archive.bin' })],
      }),
    );

    const deleteResult = await service.deletePaths(
      ['/archive/archive.bin', '/missing.txt'],
      true,
    );
    expect(deleteResult.succeeded).toBe(1);
    expect(deleteResult.failed).toBe(1);
  });

  it('creates a short-lived preview descriptor for supported files', async () => {
    const descriptor = await service.createPreviewToken('/alpha.txt');
    const resolved = await service.resolvePreviewToken(descriptor.token);

    expect(descriptor).toEqual(
      expect.objectContaining({
        name: 'alpha.txt',
        path: '/alpha.txt',
        kind: 'text',
        mimeType: 'text/plain; charset=utf-8',
      }),
    );
    expect(descriptor.url).toBe(`/api/files/preview/${descriptor.token}`);
    expect(resolved.absolutePath).toBe(
      path.join(workspace, 'storage', 'alpha.txt'),
    );
  });

  it('moves deleted files to trash and restores their content', async () => {
    const storagePath = path.join(workspace, 'storage', 'recover.txt');
    await fs.writeFile(storagePath, 'recoverable');

    const trashed = await service.trashPath('/recover.txt');
    await expect(fs.access(storagePath)).rejects.toBeDefined();
    await expect(service.listTrash()).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ id: trashed.id })],
      }),
    );

    const restored = await service.restoreTrashItem(trashed.id);
    expect(restored.path).toBe('/recover.txt');
    await expect(fs.readFile(storagePath, 'utf8')).resolves.toBe('recoverable');
  });

  it('permanently removes an item from trash', async () => {
    const storagePath = path.join(workspace, 'storage', 'purge.txt');
    await fs.writeFile(storagePath, 'purge');
    const trashed = await service.trashPath('/purge.txt');

    await service.permanentlyDeleteTrashItem(trashed.id);
    await expect(service.restoreTrashItem(trashed.id)).rejects.toThrow(
      '回收站对象不存在或元数据已损坏',
    );
  });
});

function multerFile(filePath: string, size: number): Express.Multer.File {
  return {
    fieldname: 'chunk',
    originalname: path.basename(filePath),
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size,
    destination: path.dirname(filePath),
    filename: path.basename(filePath),
    path: filePath,
    buffer: Buffer.alloc(0),
    stream: undefined as never,
  };
}
