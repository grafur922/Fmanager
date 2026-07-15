import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { Observable } from 'rxjs';
import { catchError, tap, throwError } from 'rxjs';
import { redactRequestUrl } from '../utils/redact-request-url';

interface RequestWithId extends Request {
  requestId?: string;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();
    const requestId = this.resolveRequestId(request);

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          this.serialize(request, response.statusCode, Date.now() - startedAt),
        );
      }),
      catchError((error: unknown) => {
        const status =
          error instanceof HttpException
            ? error.getStatus()
            : response.statusCode || 500;
        const record = this.serialize(request, status, Date.now() - startedAt);
        if (status >= 500) this.logger.error(record);
        else this.logger.warn(record);
        return throwError(() => error);
      }),
    );
  }

  private resolveRequestId(request: Request): string {
    const header = request.headers['x-request-id'];
    const candidate = Array.isArray(header) ? header[0] : header;
    if (candidate && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate))
      return candidate;
    return randomUUID();
  }

  private serialize(
    request: Request,
    statusCode: number,
    durationMs: number,
  ): string {
    return JSON.stringify({
      requestId: (request as RequestWithId).requestId,
      method: request.method,
      path: redactRequestUrl(request.originalUrl),
      statusCode,
      durationMs,
      ip: request.ip,
      userAgent: request.headers['user-agent'] || 'unknown',
    });
  }
}
