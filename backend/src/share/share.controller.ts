import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { FileService } from '../file/file.service';
import { UserService } from '../user/user.service';
import { ShareService, UpdateShareInput } from './share.service';

interface AuthenticatedRequest extends Request {
  user: { sub: number; username: string };
}

interface CreateShareBody {
  path?: string;
  days?: number;
  password?: string;
  maxDownloads?: number | null;
}

interface UpdateShareBody {
  isEnabled?: boolean;
  days?: number;
  password?: string | null;
  maxDownloads?: number | null;
}

@Controller('api/shares')
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly fileService: FileService,
    private readonly userService: UserService,
  ) {}

  @Post()
  async createShare(
    @Body() body: CreateShareBody,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!body.path) throw new BadRequestException('分享路径不能为空');

    const normalizedPath = this.fileService.normalizeVirtualPath(body.path);
    await this.fileService.assertDownloadable(normalizedPath);
    const name = normalizedPath.split('/').filter(Boolean).at(-1);
    if (!name) throw new BadRequestException('分享文件名无效');

    const user = await this.userService.findByUsername(request.user.username);
    if (!user) throw new BadRequestException('当前用户不存在');

    const share = await this.shareService.createShare(
      {
        path: normalizedPath,
        name,
        days: Number(body.days),
        password: body.password,
        maxDownloads:
          body.maxDownloads === undefined
            ? undefined
            : body.maxDownloads === null
              ? null
              : Number(body.maxDownloads),
      },
      user,
    );
    return { success: true, data: share };
  }

  @Get()
  async listShares(@Req() request: AuthenticatedRequest) {
    const shares = await this.shareService.listShares(Number(request.user.sub));
    return { success: true, data: shares };
  }

  @Patch(':id')
  async updateShare(
    @Param('id') id: string,
    @Body() body: UpdateShareBody,
    @Req() request: AuthenticatedRequest,
  ) {
    const input: UpdateShareInput = {
      isEnabled: body.isEnabled,
      days: body.days === undefined ? undefined : Number(body.days),
      password: body.password,
      maxDownloads:
        body.maxDownloads === undefined
          ? undefined
          : body.maxDownloads === null
            ? null
            : Number(body.maxDownloads),
    };
    const share = await this.shareService.updateShare(
      id,
      Number(request.user.sub),
      input,
    );
    return { success: true, message: '分享设置已更新', data: share };
  }

  @Delete(':id')
  async deleteShare(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.shareService.deleteShare(id, Number(request.user.sub));
    return { success: true, message: '分享已删除' };
  }

  @Public()
  @Get('public/:id')
  @Header('Cache-Control', 'no-store')
  async getPublicShare(@Param('id') id: string) {
    const share = await this.shareService.getPublicShare(id);
    return { success: true, data: share };
  }

  @Public()
  @Post('public/:id/authorize')
  @Header('Cache-Control', 'no-store')
  async authorizeDownload(
    @Param('id') id: string,
    @Body('password') password: string | undefined,
    @Req() request: Request,
  ) {
    const candidate = await this.shareService.getDownloadCandidate(id);
    await this.fileService.assertDownloadable(candidate.path);
    const grant = await this.shareService.authorizeDownload(
      id,
      password,
      this.getClientIp(request),
    );
    return {
      success: true,
      data: {
        downloadUrl: `/api/shares/public/${encodeURIComponent(id)}/download?token=${encodeURIComponent(grant.token)}`,
        expiresAt: grant.expiresAt,
      },
    };
  }

  @Public()
  @Get('public/:id/download')
  async downloadAuthorizedShare(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!token) throw new BadRequestException('缺少下载凭证');
    const candidate = await this.shareService.getDownloadCandidate(id);
    const realPath = await this.fileService.assertDownloadable(candidate.path);
    const resource = await this.shareService.consumeDownloadGrant(
      id,
      token,
      this.getClientIp(request),
      request.headers['user-agent'] || 'unknown',
    );
    await this.sendDownload(response, realPath, resource.name);
  }

  @Public()
  @Get('download/:id')
  async downloadLegacyShare(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const candidate = await this.shareService.getDownloadCandidate(id);
    if (candidate.requiresPassword) {
      response.redirect(302, `/share/${encodeURIComponent(id)}`);
      return;
    }

    const realPath = await this.fileService.assertDownloadable(candidate.path);
    const resource = await this.shareService.consumeDirectDownload(
      id,
      this.getClientIp(request),
      request.headers['user-agent'] || 'unknown',
    );
    await this.sendDownload(response, realPath, resource.name);
  }

  private getClientIp(request: Request): string {
    return String(request.ip || request.socket.remoteAddress || 'unknown');
  }

  private async sendDownload(
    response: Response,
    realPath: string,
    name: string,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'private, no-store');
    await new Promise<void>((resolve, reject) => {
      response.download(realPath, name, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
