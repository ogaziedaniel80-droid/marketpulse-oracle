import { describe, expect, it } from 'vitest';
import {
  AdminOperationsManager,
  buildMapLibreCoverageConfig,
  buildRechartsTrendSeries,
  BuyerPortalManager,
  compressAndHashPhoto,
  computeCommitmentHash,
  evaluatePracticeRound,
  formatLocalWithUsdc,
  formatReporterHistoryEntry,
  getStakeAtRiskDisclosure,
  loadAllLocales,
  MockWalletProvider,
  OfflineQueueManager,
  PasskeyKitWalletAdapter,
  PERFORMANCE_BUDGET,
  SUPPORTED_LOCALES,
  t,
  validateBuyerRequestParams,
} from '../src/index.js';

describe('MarketPulse Web PWA Suite', () => {
  describe('1. i18n Locales & Safe Fallback (en, fr, ha, yo, ig, pcm, tw)', () => {
    it('loads all 7 locale catalogs without errors', () => {
      const catalogs = loadAllLocales();
      expect(Object.keys(catalogs)).toEqual(SUPPORTED_LOCALES);
      expect(catalogs.en._meta.status).toBe('complete');
      expect(catalogs.ha._meta.status).toContain('needs native review');
      expect(catalogs.pcm._meta.status).toContain('needs native review');
    });

    it('translates Hausa and Pidgin keys and falls back safely to English for missing keys', () => {
      const haWarning = t('ha', 'reporter.stake_at_risk_warning', {
        stake_local: '₦16,000 NGN',
        stake_usdc: '10.00',
      });
      expect(haWarning).toContain('₦16,000 NGN');
      expect(haWarning).toContain('10.00 USDC');

      const pcmTitle = t('pcm', 'reporter.tasks_title');
      expect(pcmTitle).toBe('Market Work Wey Dey Ground');

      // Missing key in Twi falls back safely to English
      const twFallback = t('tw', 'buyer.create_request_title');
      expect(twFallback).toBe('Create New Data Request');
    });
  });

  describe('2. Local Currency Display & Performance Budget', () => {
    it('formats USDC stroops in NGN, GHS, and XOF with USDC equivalent', () => {
      const tenUsdc = 100_000_000n; // 10 USDC
      const ngn = formatLocalWithUsdc(tenUsdc, 'NGN');
      expect(ngn.combinedDisplay).toBe('₦16,000 NGN (~10.00 USDC)');

      const ghs = formatLocalWithUsdc(tenUsdc, 'GHS');
      expect(ghs.combinedDisplay).toContain('GH₵');
      expect(ghs.combinedDisplay).toContain('(~10.00 USDC)');
    });

    it('enforces low-bandwidth reporter bundle and evidence compression budgets', () => {
      expect(PERFORMANCE_BUDGET.maxReporterInitialJsBytes).toBeLessThanOrEqual(120 * 1024);
      const rawLargePhoto = Buffer.alloc(350 * 1024, 0xab);
      const compressed = compressAndHashPhoto(rawLargePhoto);
      expect(compressed.withinBudget).toBe(true);
      expect(compressed.compressedSizeBytes).toBeLessThanOrEqual(
        PERFORMANCE_BUDGET.maxEvidenceCompressedPhotoBytes,
      );
      expect(compressed.evidenceSha256Hex).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('3. Passkey WalletProvider (Mock & Passkey-Kit Adapter)', () => {
    it('creates biometric passkey smart wallet with zero XLM requirement in MockWalletProvider', async () => {
      const mockWallet = new MockWalletProvider();
      const account = await mockWallet.createPasskeyWallet('phone_hash_demo_1');
      expect(account.requiresXlmGas).toBe(false);
      expect(account.contractAddress.startsWith('C')).toBe(true);

      const signed = await mockWallet.signSorobanInvocation({
        contractId: 'CREPORT_ENGINE',
        method: 'commit',
        argsJson: '{"request_id":1}',
      });
      expect(signed.signerAddress).toBe(account.contractAddress);
      expect(signed.sponsoredXdr.length).toBeGreaterThan(10);
    });

    it('supports PasskeyKitWalletAdapter structure for Soroban secp256r1 accounts', async () => {
      const adapter = new PasskeyKitWalletAdapter({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        walletWasmHash: 'ab'.repeat(32),
        relayerUrl: 'http://localhost:4000/v1/relay',
        rpId: 'marketpulse.africa',
        rpName: 'MarketPulse Oracle',
      });

      const account = await adapter.createPasskeyWallet('phone_hash_demo_2');
      expect(account.requiresXlmGas).toBe(false);
      const signed = await adapter.signSorobanInvocation({
        contractId: 'CREPORT_ENGINE',
        method: 'reveal',
        argsJson: '{"value":82000}',
      });
      expect(signed.signatureHex).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('4. Reporter Onboarding, Stake-at-Risk, Commit Hash & Slash Appeals', () => {
    it('evaluates 3-task no-stake practice round before graduating reporter to Tier 1', () => {
      const partial = evaluatePracticeRound([
        { taskId: 'p1', reportedPriceNgn: 81000, referenceMedianNgn: 80000 },
        { taskId: 'p2', reportedPriceNgn: 82000, referenceMedianNgn: 80000 },
      ]);
      expect(partial.graduatedToTier1).toBe(false);

      const graduated = evaluatePracticeRound([
        { taskId: 'p1', reportedPriceNgn: 81000, referenceMedianNgn: 80000 },
        { taskId: 'p2', reportedPriceNgn: 82000, referenceMedianNgn: 80000 },
        { taskId: 'p3', reportedPriceNgn: 79000, referenceMedianNgn: 80000 },
      ]);
      expect(graduated.graduatedToTier1).toBe(true);
      expect(graduated.completedCount).toBe(3);
    });

    it('displays clear stake-at-risk warning before every commit and computes sha256(value || salt)', () => {
      const disclosure = getStakeAtRiskDisclosure({
        requestId: 'req_101',
        stakeStroops: 100_000_000n,
      });
      expect(disclosure.requiresExplicitAcknowledgement).toBe(true);
      expect(disclosure.outlierSlashPercent).toBe(25);
      expect(disclosure.nonRevealSlashPercent).toBe(80);
      expect(disclosure.warningText).toContain('10.00 USDC');

      const commitHash = computeCommitmentHash(82000n, 'aa'.repeat(32));
      expect(commitHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('formats slash history with plain-language reason codes and dispute appeal links', () => {
      const entry = formatReporterHistoryEntry({
        id: 'h1',
        requestId: 'req_101',
        reporterAddress: 'CREP123',
        dataType: 'RICE50',
        marketName: 'Wuse Market',
        outcome: 'SLASHED',
        amountStroops: 25_000_000n,
        slashReasonCode: 'OUTLIER_DEVIATION',
      });
      expect(entry.plainLanguageReason).toContain('25%');
      expect(entry.appealUrl).toContain('/disputes/appeal?request_id=req_101');
    });
  });

  describe('5. Offline Queue Safety (No Double-Commit & Respects Deadlines)', () => {
    it('queues commits offline, prevents double-commits, and syncs when online', async () => {
      const queue = new OfflineQueueManager();
      queue.setOnlineStatus(false);

      const item = queue.enqueue({
        action: 'commit',
        requestId: 'req_201',
        reporterAddress: 'CREP_1',
        payload: { commitmentHash: 'ab'.repeat(32) },
        deadlineTimestampSec: 2000,
        nowSec: 1000,
      });
      expect(item.state).toBe('QUEUED_OFFLINE');

      // Attempting a second commit for the same request + reporter must throw
      expect(() =>
        queue.enqueue({
          action: 'commit',
          requestId: 'req_201',
          reporterAddress: 'CREP_1',
          payload: { commitmentHash: 'cd'.repeat(32) },
          deadlineTimestampSec: 2000,
          nowSec: 1005,
        }),
      ).toThrow(/DuplicateSubmissionPrevented/);

      // Reconnect before deadline -> flushes cleanly
      queue.setOnlineStatus(true);
      const flushed = await queue.flushQueue(async () => ({ txHash: 'tx_synced_123' }), 1500);
      expect(flushed[0].state).toBe('SYNCED');
      expect(flushed[0].txHash).toBe('tx_synced_123');
    });

    it('marks queued commits as EXPIRED_DEADLINE and never dispatches if deadline passed while offline', async () => {
      const queue = new OfflineQueueManager();
      queue.setOnlineStatus(false);

      queue.enqueue({
        action: 'reveal',
        requestId: 'req_202',
        reporterAddress: 'CREP_2',
        payload: { value: 82000 },
        deadlineTimestampSec: 2000,
        nowSec: 1800,
      });

      queue.setOnlineStatus(true);
      let dispatched = false;
      const flushed = await queue.flushQueue(async () => {
        dispatched = true;
        return { txHash: 'should_not_happen' };
      }, 2500); // nowSec = 2500 > deadline 2000

      expect(dispatched).toBe(false);
      expect(flushed[0].state).toBe('EXPIRED_DEADLINE');
    });
  });

  describe('6. Buyer Dashboard & Admin Operations', () => {
    it('validates buyer request creation with shared Zod schema and blocks disabled second-wave data types', () => {
      const valid = validateBuyerRequestParams({
        dataType: 'RICE50',
        geohash: 's14702',
        bounty: 50_000_000n,
        token: 'CUSDC_TOKEN_ADDRESS_SOROBAN',
        minStake: 10_000_000n,
        toleranceBps: 800,
        commitDeadline: 1000,
        revealDeadline: 2000,
        challengeWindow: 3600,
        minReports: 5,
        maxReports: 15,
      });
      expect(valid.dataType).toBe('RICE50');

      // Disabled second-wave type (POWER) must be rejected
      expect(() =>
        validateBuyerRequestParams({
          dataType: 'POWER',
          geohash: 's14702',
          bounty: 50_000_000n,
          token: 'CUSDC_TOKEN_ADDRESS_SOROBAN',
          minStake: 10_000_000n,
          toleranceBps: 800,
          commitDeadline: 1000,
          revealDeadline: 2000,
          challengeWindow: 3600,
          minReports: 5,
          maxReports: 15,
        }),
      ).toThrow(/DisabledDataTypeError/);
    });

    it('builds MapLibre markers, Recharts trend series, API keys, webhooks, and admin controls', () => {
      const mapCfg = buildMapLibreCoverageConfig();
      expect(mapCfg.markers.length).toBeGreaterThanOrEqual(3);

      const trend = buildRechartsTrendSeries([
        {
          timestampSec: 1700000000,
          medianPriceNgn: 80000,
          toleranceBps: 1000,
          confidenceBps: 9000,
        },
      ]);
      expect(trend[0].lowerBandNgn).toBe(72000);
      expect(trend[0].upperBandNgn).toBe(88000);

      const portal = new BuyerPortalManager();
      const key = portal.issueApiKey('Production ERP');
      expect(key.secretKey).toContain('mp_live_');
      const wh = portal.registerWebhook({
        targetUrl: 'https://buyer.example.com/webhooks/marketpulse',
        dataTypes: ['RICE50'],
      });
      expect(wh.active).toBe(true);

      const admin = new AdminOperationsManager();
      const log = admin.updateReporterStatus({
        reporterId: 'rep_1',
        action: 'suspend',
        reason: 'Collusion cluster investigation pending arbiter review',
        adminAddress: 'GADMIN_MULTISIG',
      });
      expect(log.newStatus).toBe('suspended');

      const audit = admin.scheduleGroundTruthAudit({
        requestId: 'req_101',
        sampleRateBps: 800,
      });
      expect(audit.status).toBe('scheduled');
    });
  });
});
