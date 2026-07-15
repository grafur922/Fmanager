import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { FileModule } from './file/file.module';
import { ShareLog } from './share/share-log.entity';
import { Share } from './share/share.entity';
import { ShareModule } from './share/share.module';
import { User } from './user/user.entity';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get('NODE_ENV') === 'production';
        return {
          type: 'postgres' as const,
          host: config.get<string>('DB_HOST') || 'localhost',
          port: Number(config.get<string>('DB_PORT') || 5432),
          username: config.get<string>('DB_USER') || 'postgres',
          password: config.get<string>('DB_PASS') || 'postgres',
          database: config.get<string>('DB_NAME') || 'fManage',
          entities: [User, Share, ShareLog],
          synchronize: !isProduction && config.get('DB_SYNC') !== 'false',
          ssl:
            config.get('DB_SSL') === 'true'
              ? { rejectUnauthorized: false }
              : false,
          retryAttempts: 5,
          retryDelay: 2000,
        };
      },
    }),
    FileModule,
    ShareModule,
    AuthModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
