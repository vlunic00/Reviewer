import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { buildDiffs } from '../../apps/server/src/attempts.js';
import {
  exerciseSchema,
  type ReviewAttempt,
} from '../../packages/shared/src/index.js';

async function openReview(page: Page, exerciseId = 'ts-easy-001') {
  const response = await page.request.post('/api/attempts', {
    data: { exerciseId },
  });
  expect(response.status()).toBe(201);
  const attempt = (await response.json()) as ReviewAttempt;
  await page.goto(
    `/?language=typescript&difficulty=easy&attempt=${attempt.id}`,
  );
  await expect(
    page.getByRole('heading', { name: attempt.exercise.title, exact: true }),
  ).toBeVisible();
  return attempt;
}

test('old/new/context ranges persist, edit, delete, switch views, and resume from the library', async ({
  page,
}) => {
  const attempt = await openReview(page);
  await page
    .getByRole('button', { name: 'Comment on old line 8', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('Rounding down hides the remainder page.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  await page
    .getByRole('button', { name: 'Comment on new line 8', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Comment on new line 9', exact: true })
    .click({ modifiers: ['Shift'] });
  await expect(page.getByLabel('Start line', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('End line', { exact: true })).toHaveValue('9');
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('The updated calculation drops a partially filled page.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  await page
    .getByRole('button', { name: 'Side-by-side view', exact: true })
    .click();
  await expect(
    page.getByText('Rounding down hides the remainder page.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('File version').selectOption('old');
  await expect(
    page.getByRole('button', { name: 'Comment on old line 1', exact: true }),
  ).toBeVisible();
  await page.getByLabel('File version').selectOption('diff');
  await page
    .getByRole('button', { name: 'src/list-navigation.ts', exact: false })
    .click();
  await page
    .getByRole('button', { name: 'Comment on new line 1', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Comment on new line 3', exact: true })
    .click({ modifiers: ['Shift'] });
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('The caller exposes every page returned by the helper.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  const stored = (await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json()) as ReviewAttempt;
  expect(stored.comments.map((comment) => comment.anchor)).toEqual([
    { filePath: 'src/pagination.ts', side: 'old', startLine: 8, endLine: 8 },
    { filePath: 'src/pagination.ts', side: 'new', startLine: 8, endLine: 9 },
    {
      filePath: 'src/list-navigation.ts',
      side: 'new',
      startLine: 1,
      endLine: 3,
    },
  ]);
  expect(JSON.stringify(stored)).not.toContain('failureExample');
  await page.reload();
  await page
    .getByRole('button', { name: 'src/pagination.ts', exact: false })
    .click();
  await page
    .getByRole('button', {
      name: 'Edit comment: Rounding down hides the remainder page.',
      exact: true,
    })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('A ceiling is needed to include the remainder page.');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  await page
    .getByRole('button', {
      name: 'Delete comment: The updated calculation drops a partially filled page.',
      exact: true,
    })
    .click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  await page
    .getByRole('button', { name: 'Back to library', exact: false })
    .click();
  await expect(
    page.getByRole('radio', { name: 'TypeScript', exact: true }),
  ).toBeChecked();
  await page
    .getByRole('button', {
      name: 'Continue review: Simplify pagination totals',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('A ceiling is needed to include the remainder page.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/review-desktop.png',
    fullPage: true,
  });
});

test('failed saves keep notes across reload and retry without overwriting data', async ({
  page,
}) => {
  const attempt = await openReview(page);
  await page.route('**/api/attempts/*/comments', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporary save failure.' }),
    }),
  );
  await page
    .getByRole('button', { name: 'Comment on new line 8', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('Keep this note through a failed request.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary save failure');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByText('Keep this note through a failed request.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Temporary save failure');
  await page.unroute('**/api/attempts/*/comments');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  const stored = (await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json()) as ReviewAttempt;
  expect(stored.comments[0].body).toBe(
    'Keep this note through a failed request.',
  );
});

test('an unfinished note survives file navigation and reload, including invalid editable ranges', async ({
  page,
}) => {
  await openReview(page);
  await page
    .getByRole('button', { name: 'Comment on new line 8', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('A note still being written.');
  await page.getByLabel('End line', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Choose a valid line range',
  );
  await page
    .getByRole('button', { name: 'src/list-navigation.ts', exact: false })
    .click();
  await page
    .getByRole('button', { name: 'Continue your open note', exact: false })
    .click();
  await expect(page.getByLabel('Review comment', { exact: true })).toHaveValue(
    'A note still being written.',
  );
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel('Review comment', { exact: true })).toHaveValue(
    'A note still being written.',
  );
  await page.getByLabel('End line', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
});

test('stale tabs surface a conflict and preserve the newer saved notes', async ({
  page,
}) => {
  const attempt = await openReview(page);
  const remote = {
    id: randomUUID(),
    anchor: {
      filePath: 'src/pagination.ts',
      side: 'new',
      startLine: 8,
      endLine: 8,
    },
    body: 'Saved in another tab.',
  };
  expect(
    (
      await page.request.put(`/api/attempts/${attempt.id}/comments`, {
        data: { version: 0, comments: [remote] },
      })
    ).status(),
  ).toBe(200);
  await page
    .getByRole('button', { name: 'Comment on old line 8', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('The pending local note stays available.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another tab');
  await expect(
    page.getByText('The pending local note stays available.', { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/attempts/${attempt.id}`)).json())
      .comments,
  ).toEqual([remote]);
  page.on('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Load saved draft', exact: true })
    .click();
  await expect(
    page.getByText('Saved in another tab.', { exact: true }),
  ).toBeVisible();
});

test('autosave serializes changes made while an earlier save is running', async ({
  page,
}) => {
  const attempt = await openReview(page);
  let release!: () => void;
  let signalStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  await page.route('**/api/attempts/*/comments', async (route) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls += 1;
    if (calls === 1) {
      signalStarted();
      await gate;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
    active -= 1;
  });
  await page
    .getByRole('button', { name: 'Comment on old line 8', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('First queued note.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await started;
  await page
    .getByRole('button', { name: 'Comment on new line 8', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('Second queued note.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  release();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  const saved = await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json();
  expect(
    saved.comments.map((comment: { body: string }) => comment.body),
  ).toEqual(['First queued note.', 'Second queued note.']);
  expect(maximumActive).toBe(1);
  expect(calls).toBe(2);
});

test('retry acknowledges a committed save whose response was lost', async ({
  page,
}) => {
  const attempt = await openReview(page);
  await page.route('**/api/attempts/*/comments', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await page
    .getByRole('button', { name: 'Comment on new line 8', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('Save succeeded but its response was lost.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  expect(
    (await (await page.request.get(`/api/attempts/${attempt.id}`)).json())
      .version,
  ).toBe(1);
  await page.unroute('**/api/attempts/*/comments');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  const saved = await (
    await page.request.get(`/api/attempts/${attempt.id}`)
  ).json();
  expect(saved.comments).toHaveLength(1);
  expect(saved.version).toBe(1);
});

test('fixture versions cover additions, deletions, expanded context, long lines, and narrow screens', async ({
  page,
}) => {
  const id = randomUUID();
  const before =
    Array.from(
      { length: 35 },
      (_, index) => `const value${index} = ${index};`,
    ).join('\r\n') + '\r\n';
  const exercise = exerciseSchema.parse({
    schemaVersion: 1,
    id: 'view-fixture',
    revision: 1,
    language: 'typescript',
    difficulty: 'medium',
    title: 'Inspect file versions',
    description: 'Fixture',
    commitMessage: 'Fixture',
    files: [
      {
        path: 'added.tsx',
        status: 'added',
        after: 'export const view = <div>New view</div>;\n',
      },
      { path: 'deleted.hpp', status: 'deleted', before: 'int removed();\n' },
      {
        path: 'large.rs',
        status: 'modified',
        before,
        after: before.replace('value20 = 20', 'value20 = 21'),
      },
      { path: 'empty.py', status: 'unchanged', before: '', after: '' },
      {
        path: 'long.ts',
        status: 'unchanged',
        before: `const value = "${'x'.repeat(300)}";\n`,
        after: `const value = "${'x'.repeat(300)}";\n`,
      },
    ],
  });
  let fixture: ReviewAttempt = {
    id,
    exercise,
    state: 'draft',
    version: 0,
    startedAt: new Date().toISOString(),
    comments: [],
    diffs: buildDiffs(exercise),
  };
  await page.route(`**/api/attempts/${id}`, (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route(`**/api/attempts/${id}/comments`, (route) => {
    const body = route.request().postDataJSON();
    fixture = {
      ...fixture,
      comments: body.comments,
      version: fixture.version + 1,
    };
    return route.fulfill({ json: fixture });
  });
  await page.goto(`/?attempt=${id}`);
  await page
    .getByRole('button', { name: 'Comment on new line 1', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('A note on an added line.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  await page.getByRole('button', { name: 'deleted.hpp', exact: false }).click();
  await page
    .getByRole('button', { name: 'Comment on old line 1', exact: true })
    .click();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('A note on a deleted file.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  await page.getByRole('button', { name: 'large.rs', exact: false }).click();
  await expect(
    page.getByRole('button', { name: 'Comment on old line 1', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Expand all context', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Comment on old line 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'empty.py', exact: false }).click();
  await expect(
    page.getByText('This file is empty.', { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'long.ts', exact: false }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Comment on new line 1', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('A keyboard-created context note.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('All comments saved');
  await page.screenshot({
    path: 'test-results/review-mobile.png',
    fullPage: true,
  });
  expect(fixture.comments.map((comment) => comment.anchor.side)).toEqual([
    'new',
    'old',
    'new',
  ]);
});

test('a partially hidden range in a long file stays complete and leaves unrelated context collapsed', async ({
  page,
}) => {
  const id = randomUUID();
  const before =
    Array.from(
      { length: 2000 },
      (_, index) => `const value${index} = ${index};`,
    ).join('\r\n') + '\r\n';
  const exercise = exerciseSchema.parse({
    schemaVersion: 1,
    id: 'long-range-fixture',
    revision: 1,
    language: 'typescript',
    difficulty: 'medium',
    title: 'Review a long source file',
    description: 'Fixture',
    commitMessage: 'Fixture',
    files: [
      {
        path: 'large.ts',
        status: 'modified',
        before,
        after: before.replace('value1000 = 1000', 'value1000 = -1'),
      },
    ],
  });
  const fixture: ReviewAttempt = {
    id,
    exercise,
    state: 'draft',
    version: 0,
    startedAt: new Date().toISOString(),
    comments: [],
    diffs: buildDiffs(exercise),
  };
  await page.route(`**/api/attempts/${id}`, (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto(`/?attempt=${id}`);
  await page
    .getByRole('button', { name: 'Comment on new line 1001', exact: true })
    .click();
  await page.getByLabel('Start line', { exact: true }).fill('990');
  await page.getByLabel('End line', { exact: true }).fill('1003');
  await expect(page.locator('.diff-code-selected')).toHaveCount(14);
  await expect(
    page.getByRole('button', { name: 'Comment on new line 990', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Comment on new line 1', exact: true }),
  ).toHaveCount(0);
  expect(await page.locator('.line-button').count()).toBeLessThan(60);
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('This range includes context before the changed line.');
  await expect(page.locator('.diff-code-selected')).toHaveCount(14);
  await page.getByRole('button', { name: 'Cancel note', exact: true }).click();
  await page
    .getByRole('button', { name: 'Expand all context', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Comment on new line 1', exact: true })
    .click();
  await page.getByLabel('Start line', { exact: true }).fill('990');
  await page.getByLabel('End line', { exact: true }).fill('1003');
  await page
    .getByRole('button', { name: 'Collapse context', exact: true })
    .click();
  await expect(
    page.getByRole('form', { name: 'Comment editor' }),
  ).toBeVisible();
  expect(await page.locator('.line-button').count()).toBeLessThan(80);
  await page.getByRole('button', { name: 'Cancel note', exact: true }).click();
});
