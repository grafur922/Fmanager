import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { FileService } from './file/file.service';
import { ShareService } from './share/share.service';

describe('AppController', () => {
  let appController: AppController;

  const fileService = {
    getStorageStats: jest.fn().mockResolvedValue({
      totalFiles: 3,
      totalFolders: 2,
      totalBytes: 1024,
      storageLimitBytes: 10_240,
      recentFiles: [],
    }),
  };
  const shareService = {
    listShares: jest
      .fn()
      .mockResolvedValue([
        { expiresAt: new Date(Date.now() + 60_000) },
        { expiresAt: new Date(Date.now() - 60_000) },
      ]),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: FileService, useValue: fileService },
        { provide: ShareService, useValue: shareService },
      ],
    }).compile();

    appController = app.get(AppController);
  });

  it('returns storage and active share statistics', async () => {
    await expect(appController.getDashboardStats()).resolves.toEqual({
      success: true,
      data: {
        totalFiles: 3,
        totalFolders: 2,
        totalBytes: 1024,
        storageLimitBytes: 10_240,
        recentFiles: [],
        activeShares: 1,
        totalShares: 2,
      },
    });
  });
});
