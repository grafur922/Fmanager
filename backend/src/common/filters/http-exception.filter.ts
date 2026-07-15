import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { redactRequestUrl } from '../utils/redact-request-url';

interface RequestWithId extends Request {
  requestId?: string;
}

interface ErrorResponseBody {
  message?: string | string[];
  error?: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    if (response.headersSent) return;

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionBody =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const normalizedBody =
      typeof exceptionBody === 'object' && exceptionBody !== null
        ? (exceptionBody as ErrorResponseBody)
        : undefined;
    const rawMessage =
      typeof exceptionBody === 'string'
        ? exceptionBody
        : normalizedBody?.message ||
          (exception instanceof Error ? exception.message : undefined);
    const message = Array.isArray(rawMessage)
      ? rawMessage.join('；')
      : rawMessage || '请求处理失败';
    const wasIntercepted = Boolean(request.requestId);
    const requestId = request.requestId || randomUUID();

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    const record = JSON.stringify({
      requestId,
      method: request.method,
      path: redactRequestUrl(request.originalUrl),
      statusCode: status,
      ip: request.ip,
      userAgent: request.headers['user-agent'] || 'unknown',
    });
    if (!wasIntercepted) {
      if (status >= 500) this.logger.error(record);
      else this.logger.warn(record);
    }
    if (status >= 500) {
      const detail =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `${request.method} ${redactRequestUrl(request.originalUrl)} ${status} requestId=${requestId}`,
        detail,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      error: normalizedBody?.error || this.getErrorName(exception, status),
      message:
        status >= 500 && process.env.NODE_ENV === 'production'
          ? '服务器内部错误'
          : message,
      requestId,
      timestamp: new Date().toISOString(),
      path: redactRequestUrl(request.originalUrl),
    });
  }

  private getErrorName(exception: unknown, status: number): string {
    if (exception instanceof Error && exception.name) return exception.name;
    return HttpStatus[status] || 'Error';
  }
}
