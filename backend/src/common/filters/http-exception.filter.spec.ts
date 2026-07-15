import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('returns a stable error payload with a request id', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const request = {
      method: 'GET',
      originalUrl: '/api/files/list',
      requestId: 'request-test-1',
      headers: {},
    };
    const setHeader = jest.fn();
    const response = { status, setHeader, headersSent: false };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(
      new BadRequestException('查询参数无效'),
      host,
    );

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'request-test-1');
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 400,
        message: '查询参数无效',
        requestId: 'request-test-1',
        path: '/api/files/list',
      }),
    );
  });
});
