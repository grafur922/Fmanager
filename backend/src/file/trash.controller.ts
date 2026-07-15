import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { FileService } from './file.service';
import type { FileSortOrder, TrashItem } from './file.service';

@Controller('api/trash')
export class TrashController {
  constructor(private readonly fileService: FileService) {}

  @Get()
  async listTrash(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('sortBy') sortBy?: 'name' | 'size' | 'deletedAt',
    @Query('sortOrder') sortOrder?: FileSortOrder,
  ): Promise<{
    success: boolean;
    data: TrashItem[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const result = await this.fileService.listTrash({
      page: Number(page || 1),
      pageSize: Number(pageSize || 20),
      keyword,
      sortBy,
      sortOrder,
    });
    return {
      success: true,
      data: result.items,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    };
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    const restored = await this.fileService.restoreTrashItem(id);
    return { success: true, message: '对象已恢复', data: restored };
  }

  @Delete(':id')
  async permanentlyDelete(@Param('id') id: string) {
    await this.fileService.permanentlyDeleteTrashItem(id);
    return { success: true, message: '对象已永久删除' };
  }

  @Delete()
  async emptyTrash() {
    const deleted = await this.fileService.emptyTrash();
    return { success: true, message: '回收站已清空', data: { deleted } };
  }
}
