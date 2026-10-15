import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { AssessmentService } from '../apps/server/src/assessment-service.js';
import { createAttempt, saveComments } from '../apps/server/src/attempts.js';
import { getRuns, submitAttempt } from '../apps/server/src/assessment-store.js';
import { loadCases } from '../apps/server/src/cases.js';
import { openDatabase } from '../apps/server/src/database.js';

it('stops queued inference and ignores late model responses after database shutdown', async () => {
  const loaded = (await loadCases(resolve('data/cases'))).get('py-medium-001')!;
  const db = openDatabase(':memory:');
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    entered = done;
  });
  let signal: AbortSignal | undefined;
  const evaluate = vi.fn(
    async (_exercise, _key, comment, _model, requestSignal) => {
      signal = requestSignal;
      entered();
      await gate;
      return { commentId: comment.id, findings: [] };
    },
  );
  const service = new AssessmentService(db, {
    model: 'local-test',
    inspect: async () => ({
      model: 'local-test',
      digest: null,
      disableThinking: false,
    }),
    evaluate,
    status: async () => ({
      available: true,
      model: 'local-test',
      url: 'http://127.0.0.1:11434',
      timeoutMs: 120000,
      error: null,
    }),
  });
  const errors = vi.spyOn(console, 'error');
  let closed = false;
  try {
    const attempts = [0, 1].map(() => {
      const draft = createAttempt(db, loaded);
      saveComments(db, draft.id, {
        version: 0,
        comments: [
          {
            id: randomUUID(),
            body: 'Counting exhausts the iterator.',
            anchor: {
              filePath: 'app/refresh.py',
              side: 'new',
              startLine: 9,
              endLine: 13,
            },
          },
        ],
      });
      service.enqueue(submitAttempt(db, draft.id, 1));
      return draft.id;
    });
    await started;
    expect(attempts.map((id) => getRuns(db, id)[0].status)).toEqual([
      'running',
      'pending',
    ]);
    service.stop();
    db.close();
    closed = true;
    expect(signal?.aborted).toBe(true);
    release();
    await new Promise(setImmediate);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    service.stop();
    release();
    if (!closed) db.close();
    errors.mockRestore();
  }
});
