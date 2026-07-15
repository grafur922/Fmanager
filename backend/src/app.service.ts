import { Injectable, OnModuleInit } from '@nestjs/common';
import { UserService } from './user/user.service';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly userService: UserService) {}

  async onModuleInit(): Promise<void> {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const configuredPassword = process.env.ADMIN_PASSWORD;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && !configuredPassword) {
      console.warn(
        '[Security] 未设置 ADMIN_PASSWORD，生产环境不会自动创建默认管理员。',
      );
      return;
    }

    const password = configuredPassword || '123456';
    const existing = await this.userService.findByUsername(username);
    if (!existing) {
      await this.userService.createUser(username, password);
      console.warn(
        `[Seed] 已创建管理员账号 ${username}。${configuredPassword ? '' : '当前使用开发环境默认密码，请立即修改。'}`,
      );
    }
  }
}
