import { Module } from '@nestjs/common';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { TrashController } from './trash.controller';

@Module({
  controllers: [FileController, TrashController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
