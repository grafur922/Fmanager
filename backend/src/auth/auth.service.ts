import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
  ) {}

  async signIn(
    username: string,
    password: string,
  ): Promise<{ access_token: string }> {
    if (!username || !password) {
      throw new UnauthorizedException('请输入用户名和密码');
    }

    const user = await this.userService.findByUsername(username);
    if (!user || !(await this.userService.validatePassword(user, password))) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    return {
      access_token: await this.jwtService.signAsync({
        sub: user.id,
        username: user.username,
      }),
    };
  }
}
