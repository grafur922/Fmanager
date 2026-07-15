import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signIn(@Body() body: { username?: string; password?: string }) {
    const result = await this.authService.signIn(
      String(body.username || '').trim(),
      String(body.password || ''),
    );
    return { success: true, data: result };
  }
}
