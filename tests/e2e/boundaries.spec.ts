import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { buildDiffs } from '../../apps/server/src/attempts.js';
import type { ReviewAttempt } from '../../packages/shared/src/index.js';

test('the development server cannot expose private files through Vite filesystem URLs', async ({
  request,
}) => {
  for (const path of [
    'data/cases/typescript/easy/ts-easy-001/answer-key.json',
    'data/cases/python/medium/py-medium-001/answer-key.json',
  ]) {
    const response = await request.get(
      '/@fs/' + resolve(path).replaceAll('\\', '/'),
    );
    expect(response.status()).toBe(403);
    expect(await response.text()).toContain(
      'outside of Vite serving allow list',
    );
  }
  expect(
    (
      await request.get(
        '/@fs/' + resolve('packages/shared/src/index.ts').replaceAll('\\', '/'),
      )
    ).status(),
  ).toBe(200);
  const response = await request.get('/api/cases/ts-easy-001');
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toMatch(
    /failureExample|acceptableExplanations|correctedCode/,
  );
});

test('source, learner notes, and AI feedback render markup as text', async ({
  page,
}) => {
  const response = await page.request.post('/api/attempts', {
    data: { exerciseId: 'ts-easy-001' },
  });
  const draft: ReviewAttempt = await response.json();
  const payload =
    '<img src="https://example.com/tracker" onerror="window.__unsafe = true">';
  const source = `// ${payload}\n`;
  draft.exercise.files[0].after = source;
  draft.diffs = buildDiffs(draft.exercise);
  draft.comments = [
    {
      id: randomUUID(),
      body: payload,
      anchor: {
        filePath: draft.exercise.files[0].path,
        side: 'new',
        startLine: 1,
        endLine: 1,
      },
    },
  ];
  let fixture = draft;
  await page.route(`**/api/attempts/${draft.id}`, (route) =>
    route.fulfill({ json: fixture }),
  );
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5199/'))
      external.push(request.url());
  });
  await page.goto(`/?attempt=${draft.id}`);
  await expect(
    page.locator('.diff-code').getByText(source.trim(), { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.review-note p')).toHaveText(payload);
  const submitted = await page.request.post(
    `/api/attempts/${draft.id}/submit`,
    { data: { version: 0 } },
  );
  fixture = await submitted.json();
  fixture.comments = draft.comments;
  fixture.results!.runs[0].mode = 'AI-assisted';
  fixture.results!.runs[0].assessments = [
    {
      commentId: draft.comments[0].id,
      findings: [
        { matchedIssueId: 'issue-001', status: 'supported', feedback: payload },
      ],
    },
  ];
  fixture.results!.runs[0].summary = {
    foundIssueIds: ['issue-001'],
    foundCount: 1,
    missedCount: 0,
  };
  fixture.results!.lessons[0].explanation = payload;
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Found issues (1)', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.worked-lesson')).toContainText(payload);
  await expect(page.locator('.personal-feedback p')).toContainText(payload);
  await expect(page.locator('.submitted-comments blockquote')).toHaveText(
    payload,
  );
  await expect(page.locator('main img, main iframe, main script')).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => Reflect.get(window, '__unsafe')),
  ).toBeUndefined();
  expect(external).toEqual([]);
});
