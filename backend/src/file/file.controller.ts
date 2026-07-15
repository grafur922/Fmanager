import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Public } from '../auth/public.decorator';
import { FileService } from './file.service';
import type {
  BatchOperationResult,
  FileInfo,
  FileSortBy,
  FileSortOrder,
  PreviewDescriptor,
} from './file.service';

interface AuthenticatedRequest extends Request {
  user: { sub: number; username: string };
}

@Controller('api/files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('list')
  async listFiles(
    @Query('path') dirPath = '/',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('sortBy') sortBy?: FileSortBy,
    @Query('sortOrder') sortOrder?: FileSortOrder,
  ): Promise<{
    success: boolean;
    path: string;
    data: FileInfo[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const normalizedPath = this.fileService.normalizeVirtualPath(dirPath);
    const result = await this.fileService.listFiles(normalizedPath, {
      page: Number(page || 1),
      pageSize: Number(pageSize || 20),
      keyword,
      sortBy,
      sortOrder,
    });
    return {
      success: true,
      path: normalizedPath,
      data: result.items,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    };
  }

  @Get('download')
  async downloadFile(
    @Query('path') filePath: string,
    @Res() response: Response,
  ): Promise<void> {
    const realPath = await this.fileService.assertDownloadable(filePath);
    response.download(realPath, path.basename(realPath));
  }

  @Post('preview-token')
  async createPreviewToken(
    @Body('path') filePath: string,
  ): Promise<{ success: boolean; data: PreviewDescriptor }> {
    if (!filePath) throw new BadRequestException('预览文件路径不能为空');
    return {
      success: true,
      data: await this.fileService.createPreviewToken(filePath),
    };
  }

  @Public()
  @Get('preview/:token')
  async previewFile(
    @Param('token') token: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const preview = await this.fileService.resolvePreviewToken(token);
    const range = request.headers.range;
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60',
      'Content-Type': preview.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(preview.name)}`,
    };

    if (!range) {
      response.writeHead(200, {
        ...headers,
        'Content-Length': preview.size,
      });
      createReadStream(preview.absolutePath).pipe(response);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response
        .status(416)
        .setHeader('Content-Range', `bytes */${preview.size}`);
      response.end();
      return;
    }

    const requestedStart = match[1] ? Number(match[1]) : undefined;
    const requestedEnd = match[2] ? Number(match[2]) : undefined;
    let start = requestedStart ?? 0;
    let end = requestedEnd ?? preview.size - 1;

    if (requestedStart === undefined && requestedEnd !== undefined) {
      start = Math.max(0, preview.size - requestedEnd);
      end = preview.size - 1;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= preview.size
    ) {
      response
        .status(416)
        .setHeader('Content-Range', `bytes */${preview.size}`);
      response.end();
      return;
    }
    end = Math.min(end, preview.size - 1);

    response.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${preview.size}`,
      'Content-Length': end - start + 1,
    });
    createReadStream(preview.absolutePath, { start, end }).pipe(response);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: os.tmpdir(),
      limits: { fileSize: 32 * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('path') dirPath = '/',
  ): Promise<{ success: boolean; message: string; data: { name: string } }> {
    if (!file) throw new BadRequestException('没有检测到文件');
    const name = await this.fileService.moveUploadedFile(file, dirPath);
    return { success: true, message: '上传成功', data: { name } };
  }

  @Post('uploads/init')
  async initializeUpload(
    @Body()
    body: {
      path?: string;
      fileName: string;
      fileSize: number;
      lastModified?: number;
      resumeId?: string;
      contentHash?: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    const session = await this.fileService.initializeUpload({
      ownerId: Number(request.user.sub),
      targetDir: body.path || '/',
      fileName: body.fileName,
      fileSize: Number(body.fileSize),
      lastModified: Number(body.lastModified || 0),
      resumeId: body.resumeId,
      contentHash: body.contentHash,
    });
    return { success: true, data: session };
  }

  @Get('uploads/:uploadId')
  async getUploadStatus(
    @Param('uploadId') uploadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const session = await this.fileService.getUploadStatus(
      uploadId,
      Number(request.user.sub),
    );
    return { success: true, data: session };
  }

  @Post('uploads/:uploadId/chunks/:index')
  @UseInterceptors(
    FileInterceptor('chunk', {
      dest: os.tmpdir(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  async uploadChunk(
    @Param('uploadId') uploadId: string,
    @Param('index', ParseIntPipe) index: number,
    @UploadedFile() chunk: Express.Multer.File,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!chunk) throw new BadRequestException('没有检测到上传分片');
    const session = await this.fileService.saveUploadChunk(
      uploadId,
      Number(request.user.sub),
      index,
      chunk,
    );
    return { success: true, data: session };
  }

  @Post('uploads/:uploadId/complete')
  async completeUpload(
    @Param('uploadId') uploadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const file = await this.fileService.completeUpload(
      uploadId,
      Number(request.user.sub),
    );
    return { success: true, message: '上传完成', data: file };
  }

  @Delete('uploads/:uploadId')
  async cancelUpload(
    @Param('uploadId') uploadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.fileService.cancelUpload(uploadId, Number(request.user.sub));
    return { success: true, message: '上传任务已取消' };
  }

  @Post('mkdir')
  async createFolder(
    @Body('path') dirPath: string,
    @Body('name') folderName: string,
  ) {
    await this.fileService.createFolder(dirPath || '/', folderName);
    return { success: true, message: '文件夹创建成功' };
  }

  @Post('rename')
  async renamePath(
    @Body('path') targetPath: string,
    @Body('newName') newName: string,
  ) {
    const name = await this.fileService.renamePath(targetPath, newName);
    return { success: true, message: '重命名成功', data: { name } };
  }

  @Post('batch/delete')
  async deletePaths(
    @Body('paths') paths: string[],
  ): Promise<{ success: boolean; data: BatchOperationResult }> {
    const result = await this.fileService.trashPaths(paths);
    return { success: true, data: result };
  }

  @Post('batch/move')
  async movePaths(
    @Body('paths') paths: string[],
    @Body('targetPath') targetPath: string,
  ): Promise<{ success: boolean; data: BatchOperationResult }> {
    if (!targetPath) throw new BadRequestException('目标目录不能为空');
    const result = await this.fileService.movePaths(paths, targetPath);
    return { success: true, data: result };
  }

  @Delete()
  async deletePath(@Body('path') targetPath: string) {
    await this.fileService.trashPath(targetPath);
    return { success: true, message: '已移入回收站' };
  }
}
