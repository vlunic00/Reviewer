import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchJson } from '../apps/web/src/api.js';

afterEach(() => vi.unstubAllGlobals());
describe('browser API responses', () => {
  it('preserves HTTP status when an error response is HTML, plain text or empty', async () => {
    for (const body of ['<html>Proxy error</html>', 'Conflict', '']) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(body, { status: 409 })),
      );
      await expect(
        fetchJson('/api/attempts/example/comments'),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Request failed (409).',
      });
    }
  });
  it('uses the server error message only when it is a string', async () => {
    for (const [error, message] of [
      ['Your notes were kept.', 'Your notes were kept.'],
      [{ html: 'ignored' }, 'Request failed (503).'],
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ error }, { status: 503 })),
      );
      await expect(fetchJson('/api/attempts')).rejects.toEqual(
        new ApiError(503, message as string),
      );
    }
  });
  it('rejects invalid successful responses and passes through valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')));
    await expect(fetchJson('/api/attempts')).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ saved: true })),
    );
    await expect(fetchJson('/api/attempts')).resolves.toEqual({ saved: true });
  });
});
