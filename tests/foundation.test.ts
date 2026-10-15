import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { parseDiff } from 'react-diff-view';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  answerKeySchema,
  exerciseSchema,
  sourceLines,
  validateAnchor,
  validateAnswerKey,
} from '../packages/shared/src/index.js';
import { createApp } from '../apps/server/src/app.js';
import { loadCases, type LoadedCase } from '../apps/server/src/cases.js';
import { getProgress, openDatabase } from '../apps/server/src/database.js';
import { buildDiffs, getAttempt } from '../apps/server/src/attempts.js';

let cases: Map<string, LoadedCase>;
let database: DatabaseSync;
let server: Server;
let baseUrl: string;
const allowedOrigin = 'http://127.0.0.1:5173';
const host = new URL(allowedOrigin).host;

beforeAll(async () => {
  cases = await loadCases(resolve('data/cases'));
  database = openDatabase(':memory:');
  server = createApp(cases, database, [allowedOrigin]).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test server address.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  database?.close();
});

function request(
  path: string,
  options: {
    headers?: Record<string, string>;
    method?: string;
    body?: unknown;
  } = {},
): Promise<Response> {
  // Native HTTP preserves the Host override used to exercise the local-origin boundary.
  return new Promise((accept, reject) => {
    const outgoing = httpRequest(
      `${baseUrl}${path}`,
      {
        method: options.method ?? 'GET',
        headers: {
          host,
          ...(options.body !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
          ...options.headers,
        },
      },
      (incoming) => {
        incoming.setEncoding('utf8');
        let body = '';
        incoming.on('data', (chunk: string) => {
          body += chunk;
        });
        incoming.on('error', reject);
        incoming.on('end', () => {
          const headers = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            headers.append(
              incoming.rawHeaders[index],
              incoming.rawHeaders[index + 1],
            );
          }
          accept(new Response(body, { status: incoming.statusCode, headers }));
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end(
      options.body === undefined ? undefined : JSON.stringify(options.body),
    );
  });
}

async function removeTemporary(path: string, root: string) {
  const expectedRoot = resolve(root);
  const target = resolve(path);
  if (
    !expectedRoot.startsWith(resolve(tmpdir()) + sep) ||
    !basename(expectedRoot).startsWith('reviewer-') ||
    (target !== expectedRoot && !target.startsWith(expectedRoot + sep))
  ) {
    throw new Error(
      'Refusing to remove a path outside the test temporary directory.',
    );
  }
  await rm(target, { recursive: true });
}

describe('case validation', () => {
  it('loads a validated starter for every language', () => {
    expect(cases.size).toBe(4);
    expect(
      new Set([...cases.values()].map(({ exercise }) => exercise.language))
        .size,
    ).toBe(4);
    for (const loaded of cases.values()) {
      expect(loaded.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(loaded.answerKey.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects invalid versions, unsafe paths, duplicate paths, and private fields in public cases', () => {
    const { exercise } = cases.get('ts-easy-001')!;
    for (const patch of [
      { schemaVersion: 2 },
      { language: 'javascript' },
      { answerKey: { issues: [] } },
      { files: [{ ...exercise.files[0], path: '../secret.ts' }] },
      { files: [{ ...exercise.files[0], path: 'C:\\secret.ts' }] },
      { files: [exercise.files[0], exercise.files[0]] },
      {
        files: [{ path: 'x.ts', status: 'added', before: 'old', after: 'new' }],
      },
      {
        files: [
          { path: 'x.ts', status: 'deleted', before: 'old', after: 'new' },
        ],
      },
      {
        files: [
          { path: 'x.ts', status: 'unchanged', before: 'old', after: 'new' },
        ],
      },
    ])
      expect(exerciseSchema.safeParse({ ...exercise, ...patch }).success).toBe(
        false,
      );
  });

  it('requires nonempty keys, distinct issue IDs, and matching identity/revision', () => {
    const { exercise, answerKey } = cases.get('ts-easy-001')!;
    expect(
      answerKeySchema.safeParse({ ...answerKey, issues: [] }).success,
    ).toBe(false);
    expect(
      answerKeySchema.safeParse({
        ...answerKey,
        issues: [answerKey.issues[0], answerKey.issues[0]],
      }).success,
    ).toBe(false);
    expect(() =>
      validateAnswerKey(exercise, {
        ...answerKey,
        revision: exercise.revision + 1,
      }),
    ).toThrow('ID/revision');
    expect(() =>
      validateAnswerKey(exercise, { ...answerKey, exerciseId: 'wrong-case' }),
    ).toThrow('ID/revision');
  });

  it('requires complete worked lessons and corrections in supplied files', () => {
    const { exercise, answerKey } = cases.get('ts-easy-001')!;
    for (const field of [
      'explanation',
      'failureExample',
      'correctedCode',
      'prevention',
    ]) {
      const incomplete = structuredClone(answerKey) as unknown as {
        issues: Record<string, unknown>[];
      };
      delete incomplete.issues[0][field];
      expect(answerKeySchema.safeParse(incomplete).success).toBe(false);
    }
    const invalid = structuredClone(answerKey);
    invalid.issues[0].correctedCode[0].filePath = 'missing.ts';
    expect(() => validateAnswerKey(exercise, invalid)).toThrow('unknown file');
    invalid.issues[0].correctedCode = [];
    expect(answerKeySchema.safeParse(invalid).success).toBe(false);
  });

  it('validates old/new anchors against real lines, including CRLF and empty files', () => {
    const { exercise } = cases.get('ts-easy-001')!;
    const small = exerciseSchema.parse({
      ...exercise,
      files: [
        {
          path: 'file.ts',
          status: 'modified',
          before: 'a\r\nb\r\n',
          after: 'a\nb\nc',
        },
        { path: 'empty.ts', status: 'added', after: '' },
      ],
    });
    expect(sourceLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(sourceLines('')).toEqual([]);
    expect(sourceLines('\n')).toEqual(['']);
    expect(sourceLines('a\n\n')).toEqual(['a', '']);
    expect(() =>
      validateAnchor(small, {
        filePath: 'file.ts',
        side: 'old',
        startLine: 1,
        endLine: 2,
      }),
    ).not.toThrow();
    expect(() =>
      validateAnchor(small, {
        filePath: 'file.ts',
        side: 'new',
        startLine: 2,
        endLine: 3,
      }),
    ).not.toThrow();
    for (const anchor of [
      { filePath: 'file.ts', side: 'old', startLine: 1, endLine: 3 },
      { filePath: 'empty.ts', side: 'new', startLine: 1, endLine: 1 },
      { filePath: 'empty.ts', side: 'old', startLine: 1, endLine: 1 },
      { filePath: 'missing.ts', side: 'new', startLine: 1, endLine: 1 },
      { filePath: 'file.ts', side: 'new', startLine: 3, endLine: 2 },
    ] as const)
      expect(() => validateAnchor(small, anchor)).toThrow();
  });

  it('fails the loader on duplicate cases, missing keys, and bad issue anchors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reviewer-cases-'));
    const { exercise, answerKey } = cases.get('ts-easy-001')!;
    try {
      await mkdir(join(directory, 'first'));
      await writeFile(
        join(directory, 'first', 'exercise.json'),
        JSON.stringify(exercise),
      );
      await expect(loadCases(directory)).rejects.toThrow('both JSON files');
      await writeFile(
        join(directory, 'first', 'answer-key.json'),
        JSON.stringify(answerKey),
      );
      await mkdir(join(directory, 'second'));
      await writeFile(
        join(directory, 'second', 'exercise.json'),
        JSON.stringify(exercise),
      );
      await writeFile(
        join(directory, 'second', 'answer-key.json'),
        JSON.stringify(answerKey),
      );
      await expect(loadCases(directory)).rejects.toThrow('Duplicate case ID');
      await removeTemporary(join(directory, 'second'), directory);
      const badKey = structuredClone(answerKey);
      badKey.issues[0].locations[0].endLine = 999;
      await writeFile(
        join(directory, 'first', 'answer-key.json'),
        JSON.stringify(badKey),
      );
      await expect(loadCases(directory)).rejects.toThrow('real old-side lines');
    } finally {
      await removeTemporary(directory, directory);
    }
  });
});

describe('public API boundaries', () => {
  it('returns four languages and correctly composes all 12 filter combinations', async () => {
    const catalog = await request('/api/languages');
    expect(
      (await catalog.json()).map((language: { id: string }) => language.id),
    ).toEqual(['typescript', 'python', 'cpp', 'rust']);
    for (const language of ['typescript', 'python', 'cpp', 'rust']) {
      for (const difficulty of ['easy', 'medium', 'hard']) {
        const response = await request(
          `/api/cases?language=${language}&difficulty=${difficulty}`,
        );
        expect(response.status).toBe(200);
        const summaries = await response.json();
        const matching = [...cases.values()].filter(
          ({ exercise }) =>
            exercise.language === language &&
            exercise.difficulty === difficulty,
        );
        expect(summaries.map((item: { id: string }) => item.id)).toEqual(
          matching.map(({ exercise }) => exercise.id),
        );
        for (const summary of summaries) {
          expect(summary.language).toBe(language);
          expect(summary.difficulty).toBe(difficulty);
          expect(summary).not.toHaveProperty('files');
          expect(summary).not.toHaveProperty('issues');
          expect(summary.changedFileCount).toBe(1);
        }
      }
    }
  });

  it('returns only public exercise data and never serves raw keys or filesystem paths', async () => {
    for (const [id, loaded] of cases) {
      const response = await request(`/api/cases/${id}`);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json();
      expect(body).toEqual(loaded.exercise);
      expect(body).not.toHaveProperty('answerKey');
      expect(JSON.stringify(body)).not.toContain(
        loaded.answerKey.issues[0].suggestedFix,
      );
    }
    for (const path of [
      '/api/answer-key.json',
      '/api/cases/ts-easy-001/answer-key.json',
      '/data/app.sqlite',
      '/data/cases/typescript/easy/ts-easy-001/answer-key.json',
    ]) {
      expect((await request(path)).status).toBe(404);
    }
  });

  it('rejects malformed filters, invalid IDs, foreign origins, and foreign Host headers', async () => {
    for (const query of [
      '',
      '?language=rust',
      '?language=go&difficulty=easy',
      '?language=rust&difficulty=expert',
      '?language=rust&language=python&difficulty=easy',
    ]) {
      expect((await request(`/api/cases${query}`)).status).toBe(400);
    }
    expect((await request('/api/cases/INVALID')).status).toBe(400);
    expect((await request('/api/cases/missing-case')).status).toBe(404);
    expect(
      (
        await request('/api/languages', {
          headers: { origin: 'https://foreign.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/languages', {
          headers: { host: 'foreign.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await request('/api/languages', { headers: { origin: allowedOrigin } }))
        .status,
    ).toBe(200);
  });
});

describe('SQLite foundation', () => {
  it('keeps progress and private snapshots across database restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reviewer-progress-'));
    const file = join(directory, 'app.sqlite');
    let local = openDatabase(file);
    const loaded = cases.get('ts-easy-001')!;
    try {
      local
        .prepare(
          `INSERT INTO attempts
        (id, exercise_id, revision, checksum, exercise_snapshot, answer_key_snapshot, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'draft-1',
          loaded.exercise.id,
          loaded.exercise.revision,
          loaded.checksum,
          JSON.stringify(loaded.exercise),
          JSON.stringify(loaded.answerKey),
          '2026-10-13T10:00:00Z',
        );
      expect(getProgress(local).get(loaded.exercise.id)).toBe('in_progress');
      local.close();
      local = openDatabase(file);
      expect(getProgress(local).get(loaded.exercise.id)).toBe('in_progress');
      expect(
        JSON.parse(
          String(
            local.prepare('SELECT answer_key_snapshot FROM attempts').get()
              ?.answer_key_snapshot,
          ),
        ),
      ).toEqual(loaded.answerKey);
      local
        .prepare(
          "UPDATE attempts SET state = 'submitted', submitted_at = ? WHERE id = ?",
        )
        .run('2026-10-13T11:00:00Z', 'draft-1');
      expect(getProgress(local).get(loaded.exercise.id)).toBe('completed');
    } finally {
      local.close();
      await removeTemporary(directory, directory);
    }
  });

  it('exposes derived progress without exposing stored answer-key snapshots', async () => {
    const loaded = cases.get('ts-easy-001')!;
    database
      .prepare(
        `INSERT INTO attempts
      (id, exercise_id, revision, checksum, exercise_snapshot, answer_key_snapshot, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'private-draft',
        loaded.exercise.id,
        loaded.exercise.revision,
        loaded.checksum,
        JSON.stringify(loaded.exercise),
        JSON.stringify(loaded.answerKey),
        '2026-10-13T10:00:00Z',
      );
    try {
      const response = await request(
        '/api/cases?language=typescript&difficulty=easy',
      );
      const body = await response.json();
      expect(body[0].status).toBe('in_progress');
      expect(body[0]).not.toHaveProperty('answer_key_snapshot');
      expect(JSON.stringify(body)).not.toContain(
        loaded.answerKey.issues[0].suggestedFix,
      );
    } finally {
      database
        .prepare('DELETE FROM attempts WHERE id = ?')
        .run('private-draft');
    }
  });
});

describe('review drafts', () => {
  async function draft() {
    const response = await request('/api/attempts', {
      method: 'POST',
      body: { exerciseId: 'ts-easy-001' },
    });
    expect(response.status).toBe(201);
    return response.json();
  }
  const comment = (side = 'new', endLine = 8) => ({
    id: randomUUID(),
    anchor: { filePath: 'src/pagination.ts', side, startLine: 8, endLine },
    body: 'The remainder page disappears.',
  });

  it('starts and reloads a private-key-free snapshot with backend-generated diffs', async () => {
    const attempt = await draft();
    expect(attempt.version).toBe(0);
    expect(attempt.comments).toEqual([]);
    expect(attempt.exercise.revision).toBe(2);
    expect(
      parseDiff(attempt.diffs['src/pagination.ts'])[0].hunks.length,
    ).toBeGreaterThan(0);
    const response = await request(`/api/attempts/${attempt.id}`);
    expect(await response.json()).toEqual(attempt);
    const serialized = JSON.stringify(attempt);
    for (const issue of cases.get('ts-easy-001')!.answerKey.issues) {
      expect(serialized).not.toContain(issue.explanation);
      expect(serialized).not.toContain(issue.prevention);
    }
    const library = await (
      await request('/api/cases?language=typescript&difficulty=easy')
    ).json();
    expect(library[0].draftAttemptId).toBe(attempt.id);
  });

  it('persists ordered old/new/context comments, edits, and deletion atomically', async () => {
    const attempt = await draft();
    const comments = [
      comment('old'),
      comment(),
      {
        id: randomUUID(),
        anchor: {
          filePath: 'src/list-navigation.ts',
          side: 'new',
          startLine: 1,
          endLine: 3,
        },
        body: 'A note on the caller.',
      },
    ];
    const saved = await request(`/api/attempts/${attempt.id}/comments`, {
      method: 'PUT',
      body: { version: 0, comments },
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).comments).toEqual(comments);
    const edited = [{ ...comments[1], body: 'A clarified explanation.' }];
    expect(
      (
        await request(`/api/attempts/${attempt.id}/comments`, {
          method: 'PUT',
          body: { version: 1, comments: edited },
        })
      ).status,
    ).toBe(200);
    const reloaded = await (
      await request(`/api/attempts/${attempt.id}`)
    ).json();
    expect(reloaded.version).toBe(2);
    expect(reloaded.comments).toEqual(edited);
  });

  it('rejects stale saves, invalid anchors, duplicate IDs, and submitted edits without data loss', async () => {
    const attempt = await draft();
    const original = [comment()];
    const url = `/api/attempts/${attempt.id}/comments`;
    expect(
      (
        await request(url, {
          method: 'PUT',
          body: { version: 0, comments: original },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(url, {
          method: 'PUT',
          body: { version: 0, comments: original },
        })
      ).status,
    ).toBe(200);
    expect(getAttempt(database, attempt.id).version).toBe(1);
    for (const [version, comments, status] of [
      [0, [], 409],
      [1, [comment('new', 999)], 400],
      [1, [original[0], original[0]], 400],
      [1, [{ ...comment(), body: ' ' }], 400],
    ] as const) {
      expect(
        (await request(url, { method: 'PUT', body: { version, comments } }))
          .status,
      ).toBe(status);
      expect(getAttempt(database, attempt.id).comments).toEqual(original);
      expect(getAttempt(database, attempt.id).version).toBe(1);
    }
    database
      .prepare(
        "UPDATE attempts SET state = 'submitted', submitted_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), attempt.id);
    expect(
      (
        await request(url, {
          method: 'PUT',
          body: { version: 1, comments: [] },
        })
      ).status,
    ).toBe(409);
    expect(getAttempt(database, attempt.id).comments).toEqual(original);
  });

  it('keeps draft content after the source case changes or disappears', async () => {
    const attempt = await draft();
    const loaded = cases.get('ts-easy-001')!;
    cases.delete('ts-easy-001');
    try {
      expect((await request('/api/cases/ts-easy-001')).status).toBe(404);
      const reloaded = await (
        await request(`/api/attempts/${attempt.id}`)
      ).json();
      expect(reloaded.exercise).toEqual(attempt.exercise);
      expect(
        (
          await request(`/api/attempts/${attempt.id}/comments`, {
            method: 'PUT',
            body: { version: 0, comments: [comment()] },
          })
        ).status,
      ).toBe(200);
    } finally {
      cases.set('ts-easy-001', loaded);
    }
  });

  it('migrates a version-1 database without replacing its historical snapshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reviewer-migration-'));
    const path = join(directory, 'progress.sqlite');
    const id = randomUUID();
    const exercise = cases.get('ts-easy-001')!.exercise;
    const legacy = new DatabaseSync(path);
    legacy.exec(
      `CREATE TABLE attempts (id TEXT PRIMARY KEY, exercise_id TEXT, revision INTEGER, checksum TEXT, exercise_snapshot TEXT, answer_key_snapshot TEXT, state TEXT DEFAULT 'draft', started_at TEXT, submitted_at TEXT); PRAGMA user_version = 1;`,
    );
    legacy
      .prepare(
        'INSERT INTO attempts (id, exercise_id, revision, checksum, exercise_snapshot, answer_key_snapshot, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        exercise.id,
        1,
        'legacy-checksum',
        JSON.stringify({ ...exercise, revision: 1 }),
        '{"legacy":"preserve me"}',
        new Date().toISOString(),
      );
    legacy.close();
    const upgraded = openDatabase(path);
    try {
      expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(
        3,
      );
      expect(getAttempt(upgraded, id).exercise.revision).toBe(1);
      expect(
        upgraded
          .prepare('SELECT answer_key_snapshot FROM attempts WHERE id = ?')
          .get(id)?.answer_key_snapshot,
      ).toBe('{"legacy":"preserve me"}');
    } finally {
      upgraded.close();
      await removeTemporary(directory, directory);
    }
  });

  it('generates added/deleted/context diffs and keeps version line numbers after deletions', () => {
    const exercise = exerciseSchema.parse({
      ...cases.get('ts-easy-001')!.exercise,
      files: [
        { path: 'add.ts', status: 'added', after: 'hello\r\n' },
        { path: 'gone.ts', status: 'deleted', before: 'bye\n' },
        {
          path: 'same.ts',
          status: 'unchanged',
          before: 'same\n',
          after: 'same\n',
        },
        {
          path: 'change.ts',
          status: 'modified',
          before: 'a\nb\nc\n',
          after: 'a\nc\n',
        },
      ],
    });
    const diffs = buildDiffs(exercise);
    expect(parseDiff(diffs['add.ts'])[0].hunks[0].changes[0].type).toBe(
      'insert',
    );
    expect(parseDiff(diffs['gone.ts'])[0].hunks[0].changes[0].type).toBe(
      'delete',
    );
    expect(parseDiff(diffs['same.ts'])[0].hunks).toEqual([]);
    const normal = parseDiff(diffs['change.ts'])[0].hunks[0].changes.at(-1)!;
    expect(normal).toMatchObject({
      type: 'normal',
      oldLineNumber: 3,
      newLineNumber: 2,
    });
  });
});
