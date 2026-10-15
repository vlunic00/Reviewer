import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attemptSchema } from '../packages/shared/src/index.js';

// Use compiled server code and an isolated database; never load the user's .env.
process.env.PORT = '3299';
process.env.WEB_PORT = '5299';
process.env.SQLITE_PATH = ':memory:';
process.env.OLLAMA_URL = 'http://127.0.0.1:1';
process.env.OLLAMA_MODEL = 'test';
process.env.OLLAMA_TIMEOUT_MS = '120000';
const { startServer }: typeof import('../apps/server/src/index.js') =
  await import(pathToFileURL(resolve('dist/apps/server/src/index.js')).href);
const { server, database, stopAssessments } = await startServer();
const base = 'http://127.0.0.1:3299';
const post = (path: string, body: unknown) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
try {
  const address = server.address();
  assert(address && typeof address !== 'string');
  assert.equal(address.address, '127.0.0.1');
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type') ?? '', /text\/html/);
  const html = await home.text();
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert(assets.some((path) => path.endsWith('.js')));
  assert(assets.some((path) => path.endsWith('.css')));
  const bundled = [];
  for (const path of assets) {
    const url = new URL(path, base);
    assert.equal(
      url.origin,
      base,
      'Production assets must be bundled locally.',
    );
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert(text.length > 0);
    bundled.push(text);
  }
  const publicCase = await (
    await fetch(base + '/api/cases/ts-easy-001')
  ).json();
  assert(!JSON.stringify(publicCase).includes('failureExample'));
  const created = await post('/api/attempts', { exerciseId: publicCase.id });
  assert.equal(created.status, 201);
  const draft = attemptSchema.parse(await created.json());
  assert.equal(draft.state, 'draft');
  assert.equal(draft.results, undefined);
  const path = `/api/attempts/${draft.id}`;
  const submitted = await post(path + '/submit', { version: 0 });
  assert.equal(submitted.status, 202);
  const saved = attemptSchema.parse(await submitted.json());
  assert.equal(saved.state, 'submitted');
  assert(saved.results);
  assert.equal(saved.results.lessons.length, 1);
  assert.deepEqual(saved.results.runs[0].summary, {
    foundIssueIds: [],
    foundCount: 0,
    missedCount: 1,
  });
  assert.equal(saved.results.runs[0].mode, 'Self-review');
  assert(saved.results.lessons[0].correctedCode[0].code);
  assert(
    bundled.every(
      (text) => !text.includes(saved.results!.lessons[0].explanation),
    ),
  );
  const repeated = await post(path + '/submit', { version: 0 });
  assert.deepEqual(attemptSchema.parse(await repeated.json()), saved);
  assert.deepEqual(
    attemptSchema.parse(await (await fetch(base + path)).json()),
    saved,
  );
  const edit = await fetch(base + path + '/comments', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 0, comments: [] }),
  });
  assert.equal(edit.status, 409);
  for (const privatePath of [
    '/data/cases/typescript/easy/ts-easy-001/answer-key.json',
    '/data/app.sqlite',
    '/.env',
    '/@fs/' +
      resolve(
        'data/cases/typescript/easy/ts-easy-001/answer-key.json',
      ).replaceAll('\\', '/'),
  ]) {
    assert.equal((await fetch(base + privatePath)).status, 404);
  }
  assert.equal(
    (
      await fetch(base + '/api/languages', {
        headers: { origin: 'https://example.com' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await post('/api/attempts', { exerciseId: 'unknown' })).status,
    404,
  );
  console.log(
    'Production smoke passed: loopback, bundled assets, private data boundaries, immutable submission, and offline lessons.',
  );
} finally {
  stopAssessments();
  await new Promise<void>((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  database.close();
}
