import { test, expect, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AnswerKey } from '../../packages/shared/src/index.js';

const mode = async (value: string) => {
  await fetch('http://127.0.0.1:11535/__test/mode', {
    method: 'POST',
    body: JSON.stringify({ mode: value }),
  });
};
test.beforeEach(async () => {
  await mode('normal');
});
test.afterEach(async () => {
  await mode('normal');
});
async function open(page: Page) {
  const attempt = await (
    await page.request.post('/api/attempts', {
      data: { exerciseId: 'py-medium-001' },
    })
  ).json();
  await page.goto(`/?language=python&difficulty=medium&attempt=${attempt.id}`);
  await expect(
    page.getByRole('heading', { name: 'Stream the row refresh', exact: true }),
  ).toBeVisible();
  return attempt;
}
async function note(page: Page, body: string, line = 9) {
  await page
    .getByRole('button', { name: `Comment on new line ${line}`, exact: true })
    .click();
  await page.getByLabel('Review comment', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
}
const finish = (page: Page) =>
  page.getByRole('button', { name: 'Finish review', exact: true }).click();

test('slow feedback refreshes finish without overlapping polls or cancelling the response', async ({
  page,
}) => {
  await page.clock.install();
  const attempt = await open(page);
  await note(page, 'both: Counting exhausts rows and errors must propagate.');
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    arrived = done;
  });
  let first!: Request;
  let polls = 0;
  await page.route(`**/api/attempts/${attempt.id}`, async (route) => {
    polls++;
    first ??= route.request();
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  await finish(page);
  await page.clock.fastForward(1300);
  await started;
  await page.clock.fastForward(6000);
  release();
  expect(await first.response()).not.toBeNull();
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
  expect(polls).toBe(1);
});

test('an empty offline review shows every complete lesson, old-side code, completion and saved history', async ({
  page,
}) => {
  await mode('offline');
  const attempt = await open(page);
  await finish(page);
  await expect(
    page.getByText('0 found · 2 missed', { exact: true }).first(),
  ).toBeVisible();
  const key: AnswerKey = JSON.parse(
    await readFile(
      'data/cases/python/medium/py-medium-001/answer-key.json',
      'utf8',
    ),
  );
  for (const lesson of key.issues) {
    const article = page.getByRole('article', {
      name: lesson.title,
      exact: true,
    });
    for (const value of [
      lesson.explanation,
      lesson.failureExample,
      lesson.whyItMatters,
      lesson.suggestedFix,
      lesson.prevention,
    ])
      await expect(article).toContainText(value);
    await expect(article.locator('pre code')).toHaveText(
      lesson.correctedCode[0].code,
    );
  }
  expect(
    (await (await fetch('http://127.0.0.1:11535/__test/count')).json()).chats,
  ).toBe(0);
  await page
    .getByRole('button', {
      name: 'app/refresh.py · Original lines 11–11',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Original lines 11–11 are highlighted.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.diff-code-selected')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: /^Edit comment:/ }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Back to lessons', exact: false })
    .click();
  await page
    .getByRole('button', { name: 'Back to library', exact: false })
    .click();
  await expect(
    page.getByRole('article').getByText('Completed', { exact: true }),
  ).toBeVisible();
  await page.getByText('Review history', { exact: true }).click();
  await expect(page.locator('.review-history')).toContainText(
    '0 found · 2 missed',
  );
  await page
    .getByRole('button', {
      name: 'Read lessons: Stream the row refresh',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(attempt.id));
  await expect(
    page.getByRole('heading', { name: 'Missed issues (2)', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/learning-lessons-mobile.png',
    fullPage: true,
  });
  await page.screenshot({
    path: 'test-results/learning-lessons-mobile-top.png',
  });
});

test('submission waits for saving, deduplicates findings, and leads with uncertain missed lessons', async ({
  page,
}) => {
  const attempt = await open(page);
  await note(
    page,
    'partial extra: Counting exhausts rows; clarify the failure contract.',
  );
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let saving = false;
  let submits = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/submit')) submits++;
  });
  await page.route(`**/api/attempts/${attempt.id}/comments`, async (route) => {
    saving = true;
    await gate;
    await route.continue();
  });
  await note(
    page,
    'partial extra: The same iterator is used again; error evidence is incomplete.',
    10,
  );
  await finish(page);
  await expect.poll(() => saving).toBe(true);
  expect(submits).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Comment on new line 9', exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByText('1 found · 1 missed', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.worked-lesson h3')).toHaveText([
    'Connection failures appear successful',
    'Logging consumes the iterator',
  ]);
  await expect(page.locator('.uncertain-label')).toContainText(
    'Not yet verified',
  );
  await expect(
    page.getByRole('heading', {
      name: 'AI-assessed, outside the reference key',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Extra findings' }),
  ).toContainText('Uncertain');
  await page.screenshot({
    path: 'test-results/learning-feedback-desktop.png',
    fullPage: true,
  });
  await page.screenshot({
    path: 'test-results/learning-feedback-desktop-top.png',
  });
  await page.reload();
  await expect(
    page.getByText('1 found · 1 missed', { exact: true }).first(),
  ).toBeVisible();
  const saved = await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json();
  expect(saved.comments).toHaveLength(2);
  expect(saved.results.runs[0].assessments).toHaveLength(2);
});

test('one comment can find several reference issues and report an extra finding', async ({
  page,
}) => {
  await open(page);
  await note(
    page,
    'both extra: Counting exhausts rows and returning [] hides failure.',
  );
  await finish(page);
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Found issues', exact: true })
      .locator('pre code'),
  ).toHaveCount(2);
  await expect(
    page.getByRole('region', { name: 'Extra findings' }),
  ).toBeVisible();
});

test('failed assessment and retry preserve lessons, earlier feedback and run history', async ({
  page,
}) => {
  await mode('invalid');
  const attempt = await open(page);
  await note(page, 'both: Counting and failure reporting are broken.');
  await finish(page);
  await expect(
    page.getByText('Automatic found/missed counts unavailable.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('twice');
  await expect(page.locator('.worked-lesson pre code')).toHaveCount(2);
  await mode('normal');
  await page
    .getByRole('button', { name: 'Retry AI feedback', exact: true })
    .click();
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
  await mode('offline');
  await page
    .getByRole('button', { name: 'Retry AI feedback', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'earlier successful feedback',
  );
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Check local AI setup', exact: true })
    .click();
  await expect(page.locator('.ai-setup')).toContainText(
    'Local AI is unavailable.',
  );
  await page.getByText('AI feedback history (3)', { exact: true }).click();
  await expect(page.locator('.assessment-history li')).toHaveCount(3);
  const saved = await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json();
  expect(
    saved.results.runs.map((run: { status: string }) => run.status),
  ).toEqual(['failed', 'succeeded', 'failed']);
});

test('saved feedback runs retain their own findings and counts across retries and reloads', async ({
  page,
}) => {
  const attempt = await open(page);
  await note(
    page,
    'both: Counting exhausts rows and failures appear successful.',
  );
  await finish(page);
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
  const original = (
    await (await page.request.get(`/api/attempts/${attempt.id}`)).json()
  ).results.runs[0];
  await mode('uncertain');
  await page
    .getByRole('button', { name: 'Retry AI feedback', exact: true })
    .click();
  await expect(
    page.getByText('0 found · 2 missed', { exact: true }).first(),
  ).toBeVisible();
  const picker = page.getByRole('combobox', {
    name: 'Saved feedback run',
    exact: true,
  });
  await expect(picker.locator('option')).toHaveCount(2);
  await expect(page.locator('.uncertain-label')).toHaveCount(2);
  const newestId = await picker.inputValue();
  expect(newestId).not.toBe(original.id);
  await picker.selectOption(original.id);
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.run-caption')).toContainText(
    original.id.slice(0, 8),
  );
  await mode('offline');
  await page
    .getByRole('button', { name: 'Retry AI feedback', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'earlier successful feedback',
  );
  await expect(picker).toHaveValue(newestId);
  await expect(
    page.getByText('0 found · 2 missed', { exact: true }).first(),
  ).toBeVisible();
  await picker.selectOption(original.id);
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(picker).toHaveValue(newestId);
  await expect(
    page.getByText('0 found · 2 missed', { exact: true }).first(),
  ).toBeVisible();
  const saved = await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json();
  expect(
    saved.results.runs.map((run: { status: string }) => run.status),
  ).toEqual(['failed', 'succeeded', 'succeeded']);
  expect(saved.results.runs[2]).toEqual(original);
});

test('unfinished notes and failed saves cannot be submitted', async ({
  page,
}) => {
  const attempt = await open(page);
  await page
    .getByRole('button', { name: 'Comment on new line 9', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('both: Iterator and failure paths.');
  await finish(page);
  await expect(page.getByRole('alert')).toContainText(
    'Add or cancel your open note',
  );
  await page.route(`**/api/attempts/${attempt.id}/comments`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Save failed. Your notes are kept.' },
    }),
  );
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await finish(page);
  await expect(page.getByRole('alert')).toContainText('Save failed');
  expect(
    (await (await page.request.get(`/api/attempts/${attempt.id}`)).json())
      .state,
  ).toBe('draft');
  await page.unroute(`**/api/attempts/${attempt.id}/comments`);
  await finish(page);
  await expect(
    page.getByText('2 found · 0 missed', { exact: true }).first(),
  ).toBeVisible();
});

for (const failure of ['lost', 'server error'])
  test(`a ${failure} submission response can be retried without duplicate jobs or editing the locked review`, async ({
    page,
  }) => {
    const attempt = await open(page);
    await note(page, 'both: Iterator and failure paths.');
    await page.route(`**/api/attempts/${attempt.id}/submit`, async (route) => {
      await route.fetch();
      if (failure === 'lost') await route.abort();
      else
        await route.fulfill({
          status: 503,
          json: { error: 'Response unavailable.' },
        });
    });
    await finish(page);
    await expect(page.getByRole('alert')).toContainText(
      'Submission could not be confirmed',
    );
    await expect(
      page.getByRole('button', { name: 'Comment on new line 9', exact: true }),
    ).toBeDisabled();
    await page.unroute(`**/api/attempts/${attempt.id}/submit`);
    await finish(page);
    await expect(
      page.getByText('2 found · 0 missed', { exact: true }).first(),
    ).toBeVisible();
    const saved = await (
      await page.request.get(`/api/attempts/${attempt.id}`)
    ).json();
    expect(saved.results.runs).toHaveLength(1);
  });

test('a nonempty offline submission keeps counts unavailable and lessons readable', async ({
  page,
}) => {
  await mode('offline');
  const attempt = await open(page);
  await note(page, 'Counting exhausts the iterator.');
  await finish(page);
  await expect(
    page.getByText('Automatic found/missed counts unavailable.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'AI feedback unavailable',
  );
  await expect(
    page
      .getByRole('region', {
        name: 'Reference lessons for self-review',
        exact: true,
      })
      .locator('pre code'),
  ).toHaveCount(2);
  await expect(
    page.getByRole('heading', { name: /^Missed issues/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText('Automatic found/missed counts unavailable.', {
      exact: true,
    }),
  ).toBeVisible();
  const saved = await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json();
  expect(saved.state).toBe('submitted');
  expect(saved.comments).toHaveLength(1);
  expect(saved.results.runs[0].summary).toBeNull();
});
