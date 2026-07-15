const SENSITIVE_QUERY_PARAMETERS = new Set(['token']);

export function redactRequestUrl(originalUrl: string): string {
  try {
    const parsed = new URL(originalUrl, 'http://internal');
    for (const key of SENSITIVE_QUERY_PARAMETERS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, 'redacted');
      }
    }
    const query = parsed.searchParams.toString();
    return `${parsed.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return String(originalUrl || '').split('?')[0];
  }
}
