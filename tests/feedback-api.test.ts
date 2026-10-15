import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { AssessmentService } from '../apps/server/src/assessment-service.js';
import { loadCases } from '../apps/server/src/cases.js';
import { openDatabase } from '../apps/server/src/database.js';
import type { CommentAssessment } from '../packages/shared/src/index.js';

let database: DatabaseSync;
let server: Server;
let base: string;
let service: AssessmentService;
let failed = false;
let active = 0;
let maximum = 0;
let calls = 0;
let release: () => void;
const gate = new Promise<void>((done) => {
  release = done;
});
beforeAll(async () => {
  const cases = await loadCases(resolve('data/cases'));
  database = openDatabase(':memory:');
  service = new AssessmentService(database, {
    model: 'test-local',
    inspect: async () => ({
      model: 'test-local',
      digest: 'sha256:fixture',
      disableThinking: false,
    }),
    status: async () => ({
      available: !failed,
      model: 'test-local',
      url: 'http://127.0.0.1:11434',
      timeoutMs: 120000,
      error: failed ? 'Ollama is unavailable.' : null,
    }),
    evaluate: async (_exercise, _key, comment): Promise<CommentAssessment> => {
      calls++;
      active++;
      maximum = Math.max(maximum, active);
      try {
        await gate;
        if (failed)
          throw new Error('Ollama is unavailable. Start it and retry.');
        return {
          commentId: comment.id,
          findings: [
            {
              matchedIssueId: 'issue-001',
              status: 'supported',
              feedback: 'You correctly traced consumption. Materialize once.',
            },
            {
              matchedIssueId: null,
              status: 'uncertain',
              feedback: 'The additional claim is not established.',
            },
          ],
        };
      } finally {
        active--;
      }
    },
  });
  server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing server address.');
  base = `http://127.0.0.1:${address.port}`;
  server.on('request', createApp(cases, database, [base], service));
});
afterAll(async () => {
  release();
  service.stop();
  await new Promise<void>((done) => server.close(() => done()));
  database.close();
});
const get = async (path: string) => (await fetch(base + path)).json();
const post = (path: string, data: unknown = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
async function draft() {
  const draft = await (
    await post('/api/attempts', { exerciseId: 'py-medium-001' })
  ).json();
  const response = await fetch(`${base}/api/attempts/${draft.id}/comments`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 0,
      comments: [
        {
          id: randomUUID(),
          body: 'Counting consumes rows. Another concern needs more evidence.',
          anchor: {
            filePath: 'app/refresh.py',
            side: 'new',
            startLine: 9,
            endLine: 13,
          },
        },
      ],
    }),
  });
  expect(response.status).toBe(200);
  return draft.id as string;
}

describe('feedback API and serial inference', () => {
  it('returns lessons immediately, serializes attempts, and deduplicates concurrent submit/retry requests', async () => {
    const first = await draft();
    expect(await get(`/api/attempts/${first}`)).not.toHaveProperty('results');
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        post(`/api/attempts/${first}/submit`, { version: 1 }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([
      202, 202, 202,
    ]);
    await vi.waitFor(() => expect(calls).toBe(1));
    const pending = await get(`/api/attempts/${first}`);
    expect(pending).toMatchObject({
      state: 'submitted',
      results: {
        lessons: expect.any(Array),
        runs: [{ status: 'running', summary: null }],
      },
    });
    expect(pending.results.lessons[0].explanation).toContain(
      'one-shot iterator',
    );
    await Promise.all([
      post(`/api/attempts/${first}/regrade`),
      post(`/api/attempts/${first}/regrade`),
    ]);
    expect((await get(`/api/attempts/${first}`)).results.runs).toHaveLength(1);
    const second = await draft();
    await post(`/api/attempts/${second}/submit`, { version: 1 });
    expect(calls).toBe(1);
    expect((await get(`/api/attempts/${second}`)).results.runs[0].status).toBe(
      'pending',
    );
    release();
    await vi.waitFor(async () =>
      expect(
        (await get(`/api/attempts/${second}`)).results.runs[0].status,
      ).toBe('succeeded'),
    );
    expect(maximum).toBe(1);
    expect(calls).toBe(2);
    const success = (await get(`/api/attempts/${first}`)).results.runs[0];
    expect(success).toMatchObject({
      model: 'test-local',
      digest: 'sha256:fixture',
      promptVersion: '1',
      assessmentVersion: '1',
      summary: { foundCount: 1, missedCount: 1 },
    });
    failed = true;
    await post(`/api/attempts/${first}/regrade`);
    await vi.waitFor(async () =>
      expect((await get(`/api/attempts/${first}`)).results.runs[0].status).toBe(
        'failed',
      ),
    );
    const history = (await get(`/api/attempts/${first}`)).results.runs;
    expect(history).toHaveLength(2);
    expect(history[0].summary).toBeNull();
    expect(history[1]).toEqual(success);
    expect(
      (await get('/api/attempts')).find(
        (attempt: { id: string }) => attempt.id === first,
      ),
    ).toMatchObject({
      latestStatus: 'failed',
      summary: { foundCount: 1, missedCount: 1 },
    });
    expect(await get('/api/system/grader')).toMatchObject({ available: false });
  });

  it('validates submission versions and request bodies without locking drafts', async () => {
    const id = await draft();
    for (const body of [{}, { version: -1 }, { version: 1, score: 100 }])
      expect((await post(`/api/attempts/${id}/submit`, body)).status).toBe(400);
    expect(
      (await post(`/api/attempts/${id}/submit`, { version: 0 })).status,
    ).toBe(409);
    expect((await get(`/api/attempts/${id}`)).state).toBe('draft');
  });
});
