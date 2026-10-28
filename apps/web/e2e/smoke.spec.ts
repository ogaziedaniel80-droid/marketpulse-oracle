import { test, expect } from '@playwright/test';
import { createWebServer } from '../src/server.js';
import type http from 'node:http';

let server: http.Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = createWebServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.describe('MarketPulse Web PWA Playwright Smoke Suite', () => {
  test('Reporter happy path: OTP sign-in, mock passkey wallet, practice round, stake-at-risk display, commit & reveal', async ({
    page,
  }) => {
    await page.goto(baseUrl);

    await expect(page.getByTestId('app-title')).toContainText('MarketPulse Oracle');

    // 1. Phone OTP sign-in & Mock Passkey wallet creation
    await page.getByTestId('otp-signin-btn').click();
    await expect(page.getByTestId('wallet-status')).toContainText('Passkey Smart Wallet Ready');

    // 2. Complete no-stake practice round
    await page.getByTestId('complete-practice-btn').click();
    await expect(page.getByTestId('practice-status')).toContainText('Tier 1 Reporter Unlocked');

    // 3. Verify Stake at Risk is prominently shown in local currency + USDC before commit
    await expect(page.getByTestId('stake-at-risk-box')).toContainText('₦16,000 NGN (~10.00 USDC)');

    // 4. Submit commit and reveal
    await page.getByTestId('commit-btn').click();
    await expect(page.getByTestId('reporter-action-state')).toContainText('COMMIT_SYNCED');

    await page.getByTestId('reveal-btn').click();
    await expect(page.getByTestId('reporter-action-state')).toContainText('REVEAL_SYNCED');

    // 5. Verify plain-language slash reason and dispute appeal link
    await expect(page.getByTestId('slash-reason-text')).toContainText('25%');
    await expect(page.getByTestId('appeal-slash-link')).toHaveAttribute(
      'href',
      /\/disputes\/appeal\?request_id=/,
    );
  });

  test('Offline-then-online queue case: queues commit offline, blocks double-commit, and syncs on reconnect', async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/?lang=pcm`);

    // Toggle offline mode
    await page.getByTestId('toggle-offline-btn').click();
    await expect(page.getByTestId('offline-banner')).toBeVisible();

    // Enqueue commit while offline
    await page.getByTestId('commit-btn').click();
    await expect(page.getByTestId('reporter-action-state')).toContainText('QUEUED_OFFLINE');

    // Second click while queued must be blocked (never double-commit)
    await page.getByTestId('commit-btn').click();
    await expect(page.getByTestId('reporter-action-state')).toContainText(
      'DuplicateSubmissionPrevented',
    );

    // Toggle back online -> queue flushes automatically
    await page.getByTestId('toggle-offline-btn').click();
    await expect(page.getByTestId('reporter-action-state')).toContainText(
      'Offline Queue Flushed: Commit SYNCED',
    );
  });

  test('Buyer request creation path: validates parameters and renders MapLibre & Recharts observations', async ({
    page,
  }) => {
    await page.goto(baseUrl);

    await page.getByTestId('buyer-geohash').fill('s14702');
    await page.getByTestId('buyer-bounty').fill('50');
    await page.getByTestId('buyer-create-btn').click();

    await expect(page.getByTestId('buyer-request-status')).toContainText(
      'REQUEST_CREATED: RICE50 @ s14702 (Escrowed 50 USDC)',
    );

    await expect(page.getByTestId('maplibre-container')).toContainText('Active Pins: 3');
    await expect(page.getByTestId('recharts-container')).toContainText('₦82000');
    await expect(page.getByTestId('observations-table')).toContainText('Wuse Market');
  });
});
