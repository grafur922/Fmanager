import { redactRequestUrl } from './redact-request-url';

describe('redactRequestUrl', () => {
  it('redacts capability tokens while preserving non-sensitive parameters', () => {
    expect(
      redactRequestUrl('/api/shares/public/id/download?token=secret&page=2'),
    ).toBe('/api/shares/public/id/download?token=redacted&page=2');
  });

  it('returns the path when the URL cannot be parsed', () => {
    expect(redactRequestUrl('http://[invalid?token=secret')).toBe(
      'http://[invalid',
    );
  });
});
