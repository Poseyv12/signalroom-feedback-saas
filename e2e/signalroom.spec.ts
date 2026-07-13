import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

function safeSuffix(projectName: string) {
  return `${projectName}-${Date.now()}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

test('renders the marketing site, stores an update request, and has no accessibility or overflow defects', async ({ page }, testInfo) => {
  const suffix = safeSuffix(testInfo.project.name);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Collect product feedback without losing requests in email and chat.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View the public demo board' })).toHaveAttribute('href', '/b/vercel-production-feedback');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://signalroom-feedback-saas.vercel.app/');

  await page.getByLabel('Email for product updates').fill(`${suffix}-updates@example.com`);
  await page.getByLabel('Company (optional)').fill('Synthetic Browser Test');
  await page.getByRole('button', { name: 'Request product updates' }).click();
  await expect(page.getByRole('status')).toContainText('Your update request is saved.');

  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('keeps the public demo viewable when live preview data is unavailable', async ({ page }) => {
  await page.route('**/api/boards/vercel-production-feedback', (route) => route.abort('failed'));
  await page.goto('/b/vercel-production-feedback');

  await expect(page.getByRole('heading', { name: 'AcmeFlow Product Roadmap' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Showing a read-only demo snapshot');
  await expect(page.getByRole('heading', { name: 'Slack request capture' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Duplicate suggestion detection' })).toBeVisible();
  await expect(page.getByText(/smoke-test/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Turn scattered requests/i })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('completes the production feedback workflow without accessibility violations', async ({ page }, testInfo) => {
  const suffix = safeSuffix(testInfo.project.name);
  const boardName = `Product Feedback ${testInfo.project.name}`;
  const boardSlug = `product-feedback-${suffix}`;
  const feedbackTitle = `Keyboard navigation ${testInfo.project.name}`;

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Turn scattered requests/i })).toBeVisible();

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const registrationAccessibility = await new AxeBuilder({ page }).analyze();
  expect(registrationAccessibility.violations).toEqual([]);

  await page.getByLabel('Name').fill('Demo Founder');
  await page.getByLabel('Email').fill(`${suffix}@example.com`);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.getByLabel('Workspace name').fill(`SignalRoom ${testInfo.project.name}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Open your first feedback board' })).toBeVisible();
  await page.getByLabel('Board name').fill(boardName);
  await page.getByLabel('Public slug').fill(boardSlug);
  await page.getByRole('button', { name: 'Create board' }).click();

  await expect(page.getByRole('heading', { name: boardName })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No requests here yet.' })).toBeVisible();
  await page.getByRole('button', { name: 'Share feedback' }).click();
  await page.getByLabel('Short title').fill(feedbackTitle);
  await page.getByLabel('Why it matters').fill('Let product managers move through requests without reaching for a mouse.');
  await page.getByRole('button', { name: 'Submit feedback' }).click();

  await expect(page.getByRole('heading', { name: feedbackTitle })).toBeVisible();
  const voteButton = page.getByRole('button', { name: `Vote for ${feedbackTitle}. 0 votes` });
  await voteButton.click();
  await expect(page.getByRole('button', { name: `Vote for ${feedbackTitle}. 1 vote` })).toBeVisible();

  await page.getByLabel('Status').selectOption('planned');
  await expect(page.getByLabel('Status')).toHaveValue('planned');

  await page.getByLabel(`Add a comment to ${feedbackTitle}`).fill('This would speed up weekly triage.');
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByText('This would speed up weekly triage.')).toBeVisible();

  await page.goto(`/b/${boardSlug}`);
  await expect(page.getByRole('heading', { name: boardName })).toBeVisible();
  await expect(page.getByRole('heading', { name: feedbackTitle })).toBeVisible();
  await expect(page.getByText('This would speed up weekly triage.')).toBeVisible();
  await expect(page.locator('cite').getByText('Demo Founder', { exact: true })).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
