import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (
    Number.isSafeInteger(trustProxyHops) &&
    trustProxyHops > 0 &&
    trustProxyHops <= 10
  ) {
    app.set('trust proxy', trustProxyHops);
  }
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
