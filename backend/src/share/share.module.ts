import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { Share } from './share.entity';
import { ShareLog } from './share-log.entity';
import { FileModule } from '../file/file.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Share, ShareLog]),
    FileModule,
    UserModule,
  ],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
