import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { loadCases } from '../../apps/server/src/cases.js';
import { languages, difficulties } from '../../packages/shared/src/index.js';

test('all language/difficulty combinations work and survive a reload', async ({
  page,
}) => {
  await page.goto('/');
  const cases = [...(await loadCases(resolve('data/cases'))).values()];
  for (const language of languages) {
    await page
      .getByRole('radio', { name: language.label, exact: true })
      .check();
    for (const difficulty of difficulties) {
      await page
        .getByRole('radio', { name: difficulty.label, exact: true })
        .check();
      const matching = cases.filter(
        ({ exercise }) =>
          exercise.language === language.id &&
          exercise.difficulty === difficulty.id,
      );
      await expect(page.getByRole('article')).toHaveCount(matching.length);
      for (const { exercise } of matching)
        await expect(
          page
            .getByRole('article')
            .getByRole('heading', { name: exercise.title, exact: true }),
        ).toBeVisible();
    }
  }
  await page.reload();
  await expect(
    page.getByRole('radio', { name: 'Rust', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('radio', { name: 'Hard', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('heading', { name: 'Relax the publication flag' }),
  ).toBeVisible();
});

test('a library with no matching exercises still has a useful empty state', async ({
  page,
}) => {
  await page.route('**/api/cases?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'No exercises here yet', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('every seeded combination opens commentable code and complete stored lessons', async ({
  page,
}) => {
  for (const { exercise, answerKey } of (
    await loadCases(resolve('data/cases'))
  ).values()) {
    const created = await page.request.post('/api/attempts', {
      data: { exerciseId: exercise.id },
    });
    expect(created.status()).toBe(201);
    const attempt = await created.json();
    await page.goto(
      `/?language=${exercise.language}&difficulty=${exercise.difficulty}&attempt=${attempt.id}`,
    );
    await expect(
      page.getByRole('heading', { name: exercise.title, exact: true }),
    ).toBeVisible();
    const anchor = answerKey.issues[0].locations[0];
    await page
      .getByRole('button', { name: anchor.filePath, exact: false })
      .click();
    await page.getByLabel('File version').selectOption(anchor.side);
    await page
      .getByRole('button', {
        name: `Comment on ${anchor.side} line ${anchor.startLine}`,
        exact: true,
      })
      .click();
    await page
      .getByLabel('Review comment', { exact: true })
      .fill('Draft reasoning can be attached to this source location.');
    await page
      .getByRole('button', { name: 'Cancel note', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Finish review', exact: true })
      .click();
    await expect(
      page
        .getByText(`0 found · ${answerKey.issues.length} missed`, {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    for (const lesson of answerKey.issues) {
      const article = page.getByRole('article', {
        name: lesson.title,
        exact: true,
      });
      for (const field of [
        lesson.explanation,
        lesson.failureExample,
        lesson.whyItMatters,
        lesson.suggestedFix,
        lesson.prevention,
      ])
        await expect(article).toContainText(field);
      await expect(article.locator('pre code')).toHaveText(
        lesson.correctedCode.map((correction) => correction.code),
      );
    }
  }
});

test('preview shows public context and files, closes with Escape, and uses local assets', async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const preview = page.getByRole('button', {
    name: 'Preview Simplify pagination totals',
  });
  await preview.click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Simplify pagination totals' }),
  ).toBeVisible();
  await expect(
    dialog.getByText('src/pagination.ts', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('src/list-navigation.ts', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Review context', { exact: true }),
  ).toBeVisible();
  await expect(dialog).not.toContainText('The last partial page disappears');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(preview).toBeFocused();
  expect(requests.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('network failures are actionable and retry loads the library', async ({
  page,
}) => {
  await page.route('**/api/cases?**', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(
    'The library couldn’t load',
  );
  await page.unroute('**/api/cases?**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Simplify pagination totals' }),
  ).toBeVisible();
});

test('desktop and narrow layouts keep controls and previews accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Simplify pagination totals' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/library-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('radio', { name: 'TypeScript', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('radio', { name: 'Python', exact: true }),
  ).toBeChecked();
  await page.getByRole('radio', { name: 'Medium', exact: true }).check();
  await page
    .getByRole('button', { name: 'Preview Stream the row refresh' })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: 'Stream the row refresh' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Close exercise overview' }).click();
  await expect(
    page.getByRole('button', { name: 'Preview Stream the row refresh' }),
  ).toBeFocused();
  await page.screenshot({
    path: 'test-results/library-mobile.png',
    fullPage: true,
  });
});
