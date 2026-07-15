import { Controller, Get } from '@nestjs/common';
import { FileService } from './file/file.service';
import { ShareService } from './share/share.service';

@Controller()
export class AppController {
  constructor(
    private readonly fileService: FileService,
    private readonly shareService: ShareService,
  ) {}

  @Get('api/stats')
  async getDashboardStats() {
    const storageStats = await this.fileService.getStorageStats();
    const shares = await this.shareService.listShares();
    const activeShares = shares.filter(
      (share) => new Date(share.expiresAt).getTime() > Date.now(),
    ).length;

    return {
      success: true,
      data: {
        ...storageStats,
        activeShares,
        totalShares: shares.length,
      },
    };
  }
}
