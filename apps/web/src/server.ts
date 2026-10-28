import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LOCALES, t, type SupportedLocale } from './i18n.js';
import { formatLocalWithUsdc } from './currency.js';
import { MockWalletProvider } from './wallet.js';
import { OfflineQueueManager } from './offline-queue.js';
import {
  compressAndHashPhoto,
  computeCommitmentHash,
  evaluatePracticeRound,
  formatReporterHistoryEntry,
  getStakeAtRiskDisclosure,
} from './reporter-flow.js';
import {
  buildMapLibreCoverageConfig,
  buildRechartsTrendSeries,
  BuyerPortalManager,
} from './buyer-dashboard.js';
import { AdminOperationsManager } from './admin-panel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export function renderPwaHtml(locale: SupportedLocale = 'en'): string {
  const stakeDisclosure = getStakeAtRiskDisclosure({
    requestId: 'req_wuse_rice_101',
    stakeStroops: 100_000_000n, // 10 USDC
    currency: 'NGN',
    locale,
  });

  const bountyDisplay = formatLocalWithUsdc(500_000_000n, 'NGN'); // 50 USDC
  const mapConfig = buildMapLibreCoverageConfig();
  const trendSeries = buildRechartsTrendSeries([
    { timestampSec: 1730000000, medianPriceNgn: 81000, toleranceBps: 800, confidenceBps: 9100 },
    { timestampSec: 1730086400, medianPriceNgn: 82000, toleranceBps: 800, confidenceBps: 9400 },
  ]);

  const sampleSlashEntry = formatReporterHistoryEntry({
    id: 'hist_slash_1',
    requestId: 'req_wuse_rice_099',
    reporterAddress: 'CREPORTER_DEMO_WALLET',
    dataType: 'RICE50',
    marketName: 'Wuse Market, Abuja',
    outcome: 'SLASHED',
    amountStroops: 25_000_000n, // 2.50 USDC (25% gentle outlier slash)
    slashReasonCode: 'OUTLIER_DEVIATION',
    locale,
  });

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t(locale, 'app.title')}</title>
  <link rel="manifest" href="/manifest.json" />
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 16px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #065f46; color: #ecfdf5; }
    .warn-box { background: #451a03; border: 2px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 12px 0; color: #fef3c7; }
    button { min-height: 48px; padding: 10px 16px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; background: #059669; color: #ffffff; margin-right: 8px; margin-top: 8px; }
    input, select { min-height: 44px; padding: 8px 12px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #ffffff; margin-right: 8px; margin-top: 4px; }
    .hidden { display: none; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #334155; }
  </style>
</head>
<body>
  <header class="card" role="banner">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
      <div>
        <h1 data-testid="app-title" style="margin:0;">${t(locale, 'app.title')}</h1>
        <p style="margin:4px 0; color:#94a3b8;">${t(locale, 'app.tagline')}</p>
      </div>
      <div>
        <span id="network-badge" data-testid="network-status" class="badge">${t(locale, 'app.online_status')}</span>
        <button id="toggle-offline-btn" data-testid="toggle-offline-btn" type="button" style="background:#475569;">Toggle Offline Mode</button>
      </div>
    </div>
    <div id="offline-banner" data-testid="offline-banner" class="warn-box hidden" role="status" aria-live="polite">
      ${t(locale, 'app.offline_banner')}
    </div>
  </header>

  <!-- 1. Reporter Onboarding, Passkey Wallet & Commit-Reveal Flow -->
  <section class="card" aria-labelledby="reporter-heading">
    <h2 id="reporter-heading">1. Reporter Flow (Passkey Smart Wallet & Commit-Reveal)</h2>
    <div>
      <label for="phone-input">${t(locale, 'auth.phone_label')}</label>
      <input id="phone-input" data-testid="phone-input" type="tel" value="+2348012345678" />
      <button id="otp-signin-btn" data-testid="otp-signin-btn" type="button">${t(locale, 'auth.verify_otp')} & ${t(locale, 'auth.create_passkey')}</button>
      <p id="wallet-status" data-testid="wallet-status">Not connected</p>
    </div>

    <div style="margin-top:12px;">
      <h3>${t(locale, 'onboarding.practice_title')}</h3>
      <button id="complete-practice-btn" data-testid="complete-practice-btn" type="button">Complete 3 Practice Checks (No Stake)</button>
      <span id="practice-status" data-testid="practice-status">0/3 completed</span>
    </div>

    <div class="warn-box" data-testid="stake-at-risk-box">
      <strong>⚠️ ${t(locale, 'reporter.stake_at_risk_title')}: ${stakeDisclosure.combinedDisplay}</strong>
      <p style="margin:6px 0 0 0;">${stakeDisclosure.warningText}</p>
    </div>

    <div>
      <p>Active Task: <strong>RICE50 - Wuse Market, Abuja (s14702)</strong> | Pool Bounty: ${bountyDisplay.combinedDisplay}</p>
      <label for="price-input">${t(locale, 'reporter.price_label')}</label>
      <input id="price-input" data-testid="price-input" type="number" value="82000" />
      <label>
        <input id="ack-stake-checkbox" data-testid="ack-stake-checkbox" type="checkbox" checked />
        I understand my stake (${stakeDisclosure.combinedDisplay}) is at risk
      </label>
      <div>
        <button id="commit-btn" data-testid="commit-btn" type="button">${t(locale, 'reporter.commit_button')}</button>
        <button id="reveal-btn" data-testid="reveal-btn" type="button">${t(locale, 'reporter.reveal_button')}</button>
      </div>
      <p id="reporter-action-state" data-testid="reporter-action-state" role="status" aria-live="polite">Idle</p>
    </div>

    <div style="margin-top:12px;">
      <h3>${t(locale, 'reporter.earnings_title')}</h3>
      <p data-testid="slash-reason-text">Recent Slash: ${sampleSlashEntry.amountDisplay} — ${sampleSlashEntry.plainLanguageReason}</p>
      <a data-testid="appeal-slash-link" href="${sampleSlashEntry.appealUrl}" style="color:#34d399;">${t(locale, 'reporter.appeal_slash')}</a>
    </div>
  </section>

  <!-- 2. Buyer Dashboard -->
  <section class="card" aria-labelledby="buyer-heading">
    <h2 id="buyer-heading">2. ${t(locale, 'buyer.dashboard_title')}</h2>
    <div>
      <h3>${t(locale, 'buyer.create_request_title')}</h3>
      <label for="buyer-datatype">${t(locale, 'buyer.data_type_label')}</label>
      <select id="buyer-datatype" data-testid="buyer-datatype">
        <option value="RICE50">RICE50 (50kg Bag Local Rice)</option>
        <option value="TOMATO">TOMATO (Wholesale Crate)</option>
      </select>
      <label for="buyer-geohash">${t(locale, 'buyer.market_label')}</label>
      <input id="buyer-geohash" data-testid="buyer-geohash" type="text" value="s14702" />
      <label for="buyer-bounty">${t(locale, 'buyer.bounty_label')}</label>
      <input id="buyer-bounty" data-testid="buyer-bounty" type="number" value="50" />
      <button id="buyer-create-btn" data-testid="buyer-create-btn" type="button">${t(locale, 'buyer.submit_request')}</button>
      <p id="buyer-request-status" data-testid="buyer-request-status" role="status" aria-live="polite">No active request created in session</p>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px;">
      <div data-testid="maplibre-container" style="background:#0f172a; padding:12px; border-radius:8px;">
        <h4>${t(locale, 'buyer.map_title')}</h4>
        <p>Map Center: [${mapConfig.center.join(', ')}] | Active Pins: ${mapConfig.markers.length}</p>
      </div>
      <div data-testid="recharts-container" style="background:#0f172a; padding:12px; border-radius:8px;">
        <h4>${t(locale, 'buyer.chart_title')}</h4>
        <p>Latest Series: ${trendSeries.map((pt) => `${pt.dateLabel}: ₦${pt.medianPriceNgn}`).join(' → ')}</p>
      </div>
    </div>

    <table data-testid="observations-table">
      <thead>
        <tr><th>Market</th><th>Geohash</th><th>Median (NGN)</th><th>Confidence</th><th>Reports</th></tr>
      </thead>
      <tbody id="observations-tbody">
        ${mapConfig.markers
          .map(
            (m) =>
              `<tr><td>${m.marketName}</td><td>${m.geohash}</td><td>₦${m.latestPriceNgn.toLocaleString('en-US')}</td><td>${(m.confidenceBps / 100).toFixed(1)}%</td><td>${m.nReports}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </section>

  <!-- 3. Admin & Arbiter Panel -->
  <section class="card" aria-labelledby="admin-heading">
    <h2 id="admin-heading">3. ${t(locale, 'admin.panel_title')}</h2>
    <p data-testid="admin-flags-summary">Advisory Flags Queue: 2 unreviewed (1 correlation_cluster, 1 evidence_duplicate) | Audits Scheduled: 1 (8% sample rate)</p>
  </section>

  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    let isOffline = false;
    let committedRequestIds = new Set();
    let queuedCommit = null;

    const toggleOfflineBtn = document.getElementById('toggle-offline-btn');
    const offlineBanner = document.getElementById('offline-banner');
    const networkBadge = document.getElementById('network-badge');
    const actionState = document.getElementById('reporter-action-state');

    toggleOfflineBtn.addEventListener('click', () => {
      isOffline = !isOffline;
      if (isOffline) {
        offlineBanner.classList.remove('hidden');
        networkBadge.textContent = 'OFFLINE (Queue Active)';
      } else {
        offlineBanner.classList.add('hidden');
        networkBadge.textContent = 'Connected (Sponsored by Relayer)';
        if (queuedCommit) {
          committedRequestIds.add(queuedCommit.requestId);
          actionState.textContent = 'Offline Queue Flushed: Commit SYNCED (' + queuedCommit.commitmentHash.slice(0, 12) + '...)';
          queuedCommit = null;
        }
      }
    });

    document.getElementById('otp-signin-btn').addEventListener('click', () => {
      const phone = document.getElementById('phone-input').value;
      document.getElementById('wallet-status').textContent =
        'Passkey Smart Wallet Ready: CPASSKEY_MOCK_' + phone.slice(-4) + ' (0 XLM needed)';
    });

    document.getElementById('complete-practice-btn').addEventListener('click', () => {
      document.getElementById('practice-status').textContent =
        '3/3 completed - Tier 1 Reporter Unlocked';
    });

    document.getElementById('commit-btn').addEventListener('click', () => {
      const reqId = 'req_wuse_rice_101';
      if (committedRequestIds.has(reqId) || (queuedCommit && queuedCommit.requestId === reqId)) {
        actionState.textContent = 'DuplicateSubmissionPrevented: Commit already exists for ' + reqId;
        return;
      }
      const price = document.getElementById('price-input').value;
      const mockHash = 'commit_sha256_' + price + '_salt32';
      if (isOffline) {
        queuedCommit = { requestId: reqId, price, commitmentHash: mockHash };
        actionState.textContent = 'QUEUED_OFFLINE: Commit stored locally (' + mockHash + ')';
      } else {
        committedRequestIds.add(reqId);
        actionState.textContent = 'COMMIT_SYNCED: ' + mockHash;
      }
    });

    document.getElementById('reveal-btn').addEventListener('click', () => {
      const price = document.getElementById('price-input').value;
      actionState.textContent = 'REVEAL_SYNCED: Price ₦' + price + ' + Evidence SHA-256 verified';
    });

    document.getElementById('buyer-create-btn').addEventListener('click', () => {
      const dt = document.getElementById('buyer-datatype').value;
      const gh = document.getElementById('buyer-geohash').value;
      const bounty = document.getElementById('buyer-bounty').value;
      if (gh.length < 6 || Number(bounty) < 3) {
        document.getElementById('buyer-request-status').textContent = 'ValidationError: Invalid request parameters';
        return;
      }
      document.getElementById('buyer-request-status').textContent =
        'REQUEST_CREATED: ' + dt + ' @ ' + gh + ' (Escrowed ' + bounty + ' USDC)';
    });
  </script>
</body>
</html>`;
}

export function createWebServer(): http.Server {
  const wallet = new MockWalletProvider();
  const offlineQueue = new OfflineQueueManager();
  const buyerPortal = new BuyerPortalManager();
  const adminOps = new AdminOperationsManager();

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost:3000');

    if (req.method === 'GET' && url.pathname === '/manifest.json') {
      const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      res.end(fs.readFileSync(manifestPath));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sw.js') {
      const swPath = path.join(PUBLIC_DIR, 'sw.js');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(fs.readFileSync(swPath));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'web-pwa',
          locales: SUPPORTED_LOCALES,
          walletProvider: wallet.providerName,
          queueCount: offlineQueue.listItems().length,
          apiKeysCount: buyerPortal.listApiKeys().length,
          auditsCount: adminOps.listScheduledAudits().length,
          sampleHash: computeCommitmentHash(82000n, '11'.repeat(32)),
          samplePractice: evaluatePracticeRound([]).requiredCount,
          sampleCompression: compressAndHashPhoto(Buffer.from('sample')).withinBudget,
        }),
      );
      return;
    }

    const localeParam = (url.searchParams.get('lang') ?? 'en') as SupportedLocale;
    const activeLocale: SupportedLocale = SUPPORTED_LOCALES.includes(localeParam)
      ? localeParam
      : 'en';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPwaHtml(activeLocale));
  });
}
