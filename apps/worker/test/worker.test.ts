import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  MockStellarRpcClient,
  EventIndexer,
  InMemoryIndexerStateStore,
  LeaderElection,
  SharedLockRegistry,
  WorkerQueueProcessor,
  WorkerMetrics,
} from '../src/index.js';
import { createServiceContainer } from '@marketpulse/shared';

describe('Worker Service Test Suite', () => {
  let rpcClient: MockStellarRpcClient;
  let store: InMemoryIndexerStateStore;
  let indexer: EventIndexer;
  let lockRegistry: SharedLockRegistry;

  beforeEach(() => {
    rpcClient = new MockStellarRpcClient(105000);
    store = new InMemoryIndexerStateStore();
    indexer = new EventIndexer(rpcClient, store, 105000);
    lockRegistry = SharedLockRegistry.getInstance();
    lockRegistry.clear();
  });

  describe('Stellar RPC Event Indexer & Idempotency', () => {
    it('indexes simulated request lifecycle into state store', async () => {
      const requestId = 'req_test_001';
      rpcClient.simulateRequestLifecycle(requestId);

      const pollResult = await indexer.pollEvents(100);
      expect(pollResult.processed).toBeGreaterThanOrEqual(14); // 1 create + 5 commit + 5 reveal + 1 resolve + 1 obs + 1 payout
      expect(pollResult.newCursor).toBeDefined();

      // Check stored request
      const req = store.requests.get(requestId);
      expect(req).toBeDefined();
      expect(req.id).toBe(requestId);
      expect(req.data_type).toBe('RICE50');
      expect(req.status).toBe('finalised');

      // Check reports (5 commitments)
      const reports = Array.from(store.reports.values()).filter(
        (r: any) => r.request_id === requestId,
      );
      expect(reports.length).toBe(5);
      expect(reports.filter((r: any) => r.revealed).length).toBe(5);

      // Check observation
      const obs = store.observations.get(requestId);
      expect(obs).toBeDefined();
      expect(obs.value).toBe('8250000');
      expect(obs.confidence_bps).toBe(8500);
      expect(obs.n_reports).toBe(5);

      // Check payout mirror
      const rep1 = 'GREPORTER000000000000000000000000000000000000000000000001';
      const payout = store.payouts.get(`${requestId}:${rep1}`);
      expect(payout).toBeDefined();
      expect(payout.claimed).toBe(true);
      expect(payout.reason_code).toBe('SUCCESS');
    });

    it('guarantees idempotency: re-processing the same events does not duplicate records', async () => {
      const requestId = 'req_idempotent_test';
      const events = rpcClient.simulateRequestLifecycle(requestId);

      // First run
      await indexer.pollEvents(100);
      const reqCount1 = store.requests.size;
      const repCount1 = store.reports.size;
      const obsCount1 = store.observations.size;

      // Reset cursor and re-process all events manually
      for (const e of events) {
        await indexer.processEvent(e);
      }

      // Assert counts are unchanged
      expect(store.requests.size).toBe(reqCount1);
      expect(store.reports.size).toBe(repCount1);
      expect(store.observations.size).toBe(obsCount1);

      const obs = store.observations.get(requestId);
      expect(obs.value).toBe('8250000');
    });

    it('persists cursor and computes indexer lag', async () => {
      rpcClient.addEvent({
        type: 'contract',
        ledger: 105001,
        ledgerClosedAt: new Date().toISOString(),
        contractId: 'CREQUESTBOARD0000000000000000000000000000000000000000001',
        topic: ['request_created', 'req_lag_1'],
        value: { request_id: 'req_lag_1', data_type: 'RICE50' },
        inSuccessfulContractCall: true,
      });
      rpcClient.advanceLedger(10); // 105000 + 10 = 105010; lag = 105010 - 105001 = 9

      const res = await indexer.pollEvents();
      expect(res.processed).toBe(1);
      expect(res.lag).toBe(9);

      const saved = await store.getCursor();
      expect(saved).toBeDefined();
      expect(saved!.ledger).toBe(105001);
    });
  });

  describe('Leader Election (README §18)', () => {
    it('elects only one leader among multiple worker instances and handles failover', async () => {
      const workerA = new LeaderElection(
        { instanceId: 'worker_instance_A', leaseDurationMs: 1000 },
        lockRegistry,
      );
      const workerB = new LeaderElection(
        { instanceId: 'worker_instance_B', leaseDurationMs: 1000 },
        lockRegistry,
      );

      // Worker A acquires leadership
      const aAcquired = await workerA.acquire();
      expect(aAcquired).toBe(true);
      expect(workerA.isLeader()).toBe(true);

      // Worker B attempts to acquire same lock and fails
      const bAcquired = await workerB.acquire();
      expect(bAcquired).toBe(false);
      expect(workerB.isLeader()).toBe(false);

      // Worker A renews leadership
      const aRenewed = await workerA.renew();
      expect(aRenewed).toBe(true);

      // Worker A shuts down / releases lock
      await workerA.release();
      expect(workerA.isLeader()).toBe(false);

      // Worker B now acquires leadership successfully (failover)
      const bFailover = await workerB.acquire();
      expect(bFailover).toBe(true);
      expect(workerB.isLeader()).toBe(true);
    });
  });

  describe('BullMQ Queue Processor (8 Core Job Types)', () => {
    let processor: WorkerQueueProcessor;
    let services: ReturnType<typeof createServiceContainer>;

    beforeEach(() => {
      services = createServiceContainer();
      processor = new WorkerQueueProcessor(services);
    });

    it('handles resolution_trigger: validates deadline and calls resolve', async () => {
      const pastDeadline = new Date(Date.now() - 10000).toISOString();
      const res = await processor.handleJob('resolution_trigger', {
        requestId: '1001',
        revealDeadline: pastDeadline,
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('Resolution triggered for request 1001');
      expect(res.data?.txHash).toBeDefined();
    });

    it('rejects resolution_trigger before deadline', async () => {
      const futureDeadline = new Date(Date.now() + 100000).toISOString();
      const res = await processor.handleJob('resolution_trigger', {
        requestId: '1002',
        revealDeadline: futureDeadline,
      });

      expect(res.success).toBe(false);
      expect(res.message).toContain('not reached yet');
    });

    it('handles finalise_trigger after challenge window', async () => {
      const pastWindow = new Date(Date.now() - 5000).toISOString();
      const res = await processor.handleJob('finalise_trigger', {
        requestId: '1003',
        challengeWindowEndsAt: pastWindow,
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('Observation finalised');
    });

    it('handles undersubscription_cancel: triggers refund', async () => {
      const res = await processor.handleJob('undersubscription_cancel', {
        requestId: '1004',
        commitDeadline: new Date().toISOString(),
        minReports: 5,
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('cancelled; bounty refunded');
    });

    it('handles ttl_extension_sweep: extends storage TTLs', async () => {
      const res = await processor.handleJob('ttl_extension_sweep', {
        contractIds: ['CBOARD1', 'CREPORT1'],
        thresholdLedgers: 5000,
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('Extended TTL for 2 contract entries');
    });

    it('handles request_assignment with multi-party seed', async () => {
      const res = await processor.handleJob('request_assignment', {
        requestId: '1005',
        data_type: 'RICE50',
        geohash: 's14b3k9x',
        seed: '0xseed1234567890abcdef',
      });

      expect(res.success).toBe(true);
      expect(res.data?.assignmentHash).toBeDefined();
      expect(res.data?.assignedCount).toBe(5);
    });

    it('handles audit_scheduling: samples requests at configured rate', async () => {
      const res = await processor.handleJob('audit_scheduling', {
        requestId: '1006',
        sampleRateBps: 10000, // 100% sample for deterministic test
      });

      expect(res.success).toBe(true);
      expect(res.data?.sampled).toBe(true);
    });

    it('handles notification_dispatch: sends SMS via SmsProvider', async () => {
      const res = await processor.handleJob('notification_dispatch', {
        toPhone: '+2348099999999',
        message: 'New MarketPulse task assigned in Mile 12 Market.',
        taskId: '1007',
      });

      expect(res.success).toBe(true);
      expect(res.data?.messageId).toBeDefined();
    });

    it('handles webhook_delivery: signs payload with HMAC-SHA256 signature', async () => {
      const secret = 'whsec_test_secret_key_12345';
      const webhookPayload = {
        observation_id: '1008',
        data_type: 'RICE50',
        value: '8250000',
      };

      const res = await processor.handleJob('webhook_delivery', {
        webhookId: 'wh_1',
        url: 'https://buyer.api/webhook',
        secret,
        eventType: 'observation.finalised',
        data: webhookPayload,
      });

      expect(res.success).toBe(true);
      expect(res.data?.signature).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify signature
      const delivered = processor.deliveredWebhooks[0];
      expect(delivered).toBeDefined();
      const rawBody = delivered.payload;
      const expectedSig = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
      expect(delivered.signature).toBe(expectedSig);
    });
  });

  describe('Prometheus Metrics Exporter (README §23)', () => {
    let metrics: WorkerMetrics;

    beforeEach(() => {
      metrics = new WorkerMetrics();
    });

    afterEach(async () => {
      await metrics.stopServer();
    });

    it('registers and exports all required metrics in Prometheus format', async () => {
      metrics.indexerLag.set(42);
      metrics.resolutionBacklog.set(3);
      metrics.relayerBalanceUsdc.set(500.25);
      metrics.jobsProcessed.inc({ job_type: 'resolution_trigger', status: 'success' });
      metrics.errorRates.inc({ component: 'indexer' });

      const text = await metrics.getMetricsText();
      expect(text).toContain('indexer_lag_ledgers 42');
      expect(text).toContain('resolution_backlog_total 3');
      expect(text).toContain('relayer_balance_usdc 500.25');
      expect(text).toContain(
        'worker_jobs_processed_total{job_type="resolution_trigger",status="success"} 1',
      );
      expect(text).toContain('worker_error_rates_total{component="indexer"} 1');
    });

    it('serves metrics over HTTP /metrics endpoint', async () => {
      metrics.indexerLag.set(15);
      const port = 9182;
      await metrics.startServer(port, '127.0.0.1');

      const res = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('indexer_lag_ledgers 15');
    });
  });
});
