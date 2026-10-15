import { test, expect } from '@playwright/test';

test('keyboard focus follows editing, submission, code inspection and return to the library', async ({
  page,
}) => {
  const attempt = await (
    await page.request.post('/api/attempts', {
      data: { exerciseId: 'ts-easy-001' },
    })
  ).json();
  await page.goto(`/?attempt=${attempt.id}`);
  await expect(page.locator('#review')).toBeFocused();
  await expect(page).toHaveTitle(
    'Simplify pagination totals · Review · Code Review Trainer',
  );
  const line = page.getByRole('button', {
    name: 'Comment on new line 8',
    exact: true,
  });
  await line.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByLabel('Review comment', { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel('Review comment', { exact: true })
    .fill('Rounding down hides the partial page.');
  await page.getByLabel('Start line', { exact: true }).fill('9');
  await page.getByRole('button', { name: 'Add comment', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Start line', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('alert')).toContainText(
    'Choose a valid line range',
  );
  await page.getByLabel('Start line', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Add comment', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(line).toBeFocused();
  await page
    .getByRole('button', {
      name: 'Edit comment: Rounding down hides the partial page.',
      exact: true,
    })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByLabel('Review comment', { exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Cancel note', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(line).toBeFocused();
  await page
    .getByRole('button', {
      name: 'Delete comment: Rounding down hides the partial page.',
      exact: true,
    })
    .focus();
  await page.keyboard.press('Enter');
  await expect(line).toBeFocused();
  await page
    .getByRole('button', { name: 'Finish review', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#review')).toBeFocused();
  await expect(page).toHaveTitle(
    'Simplify pagination totals · Lessons · Code Review Trainer',
  );
  await expect(
    page.getByRole('status').filter({ hasText: '0 found · 1 missed' }),
  ).toBeVisible();
  await page.getByText('AI feedback history (1)', { exact: true }).click();
  const location = page.getByRole('button', {
    name: 'src/pagination.ts · Original lines 8–8',
    exact: true,
  });
  await location.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.diff-code-selected')).toBeFocused();
  await expect(
    page.getByRole('region', {
      name: 'Scrollable code for src/pagination.ts',
      exact: true,
    }),
  ).toHaveAttribute('tabindex', '0');
  await page
    .getByRole('button', { name: 'Back to lessons', exact: false })
    .focus();
  await page.keyboard.press('Enter');
  await expect(location).toBeFocused();
  await expect(page.locator('.assessment-history')).toHaveAttribute('open', '');
  await page
    .getByRole('button', { name: 'Back to library', exact: false })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#library')).toBeFocused();
  await expect(page).toHaveTitle('Exercise library · Code Review Trainer');
});

test('loading and failed reviews retain a working skip target and keyboard retry', async ({
  page,
}) => {
  const attempt = await (
    await page.request.post('/api/attempts', {
      data: { exerciseId: 'ts-easy-001' },
    })
  ).json();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(`**/api/attempts/${attempt.id}`, async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
  });
  await page.goto(`/?attempt=${attempt.id}`);
  await expect(page.locator('#review')).toHaveAttribute('aria-busy', 'true');
  await page
    .getByRole('link', { name: 'Skip to review workspace', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#review')).toBeFocused();
  release();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.locator('#review')).toHaveAttribute('aria-busy', 'false');
  await page.unroute(`**/api/attempts/${attempt.id}`);
  await page.getByRole('button', { name: 'Try again', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', {
      name: 'Simplify pagination totals',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('#review')).toBeFocused();
});
