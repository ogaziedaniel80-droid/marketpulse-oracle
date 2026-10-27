import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { ApiState } from '../src/state.js';
import { validateOpenApiSpec } from '../src/openapi.js';

describe('Fastify API Test Suite', () => {
  let state: ApiState;
  let app: ReturnType<typeof buildServer>;
  const validBuyerApiKey = 'mp_live_buyer_key_default123';
  const adminSecret = 'marketpulse_admin_secret_key_123';

  beforeEach(() => {
    state = new ApiState();
    app = buildServer({ state });
  });

  describe('OpenAPI 3.1 Specification', () => {
    it('validates openapi.yaml contains all endpoints defined in README §19', () => {
      const { valid, pathCount } = validateOpenApiSpec();
      expect(valid).toBe(true);
      expect(pathCount).toBeGreaterThanOrEqual(14);
    });
  });

  describe('Buyer Endpoints & Authentication (README §19)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/observations',
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('Unauthorized');
    });

    it('rejects invalid API key with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/observations',
        headers: { authorization: 'Bearer invalid_key' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns observation list for valid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/observations?data_type=RICE50',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      expect(json.data[0].data_type).toBe('RICE50');
      expect(res.headers['x-ratelimit-limit']).toBe('60');
    });

    it('returns latest observation matching README §19 format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/observations/latest?data_type=RICE50&market=ng-lagos-mile12',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const obs = JSON.parse(res.body);
      expect(obs.data_type).toBe('RICE50');
      expect(obs.market).toBe('ng-lagos-mile12');
      expect(obs.geohash).toBe('s14b3k9x');
      expect(obs.value).toBe('8250000');
      expect(obs.decimals).toBe(2);
      expect(obs.currency).toBe('NGN');
      expect(obs.n_reports).toBe(9);
      expect(obs.confidence_bps).toBe(8700);
      expect(obs.challenge_status).toBe('closed');
      expect(obs.evidence_bundle_url).toContain('https://');
    });

    it('returns 404 for non-existent latest observation', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/observations/latest?data_type=NON_EXISTENT',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('lists supported markets with geohashes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/markets',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.count).toBe(4);
      expect(json.markets.some((m: any) => m.id === 'ng-lagos-mile12')).toBe(true);
    });

    it('lists approved launch and planned data types', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/datatypes',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.launch_types.RICE50.enabled).toBe(true);
      expect(json.launch_types.TOMATO.enabled).toBe(true);
    });

    it('creates data request and returns request id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/requests',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
        payload: {
          data_type: 'RICE50',
          geohash: 's14b3k9x',
          bounty_usdc: 10.0,
          tolerance_bps: 800,
          min_reports: 5,
        },
      });
      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.body);
      expect(json.status).toBe('open');
      expect(json.request_id).toBeDefined();

      // Retrieve request details
      const detailRes = await app.inject({
        method: 'GET',
        url: `/v1/requests/${json.request_id}`,
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
      });
      expect(detailRes.statusCode).toBe(200);
      expect(JSON.parse(detailRes.body).id).toBe(json.request_id);
    });

    it('creates data request with fiat billing payment link', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/requests',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
        payload: {
          data_type: 'TOMATO',
          geohash: 's11f4r12',
          bounty_usdc: 5.0,
          funding_method: 'fiat_paystack',
          buyer_email: 'buyer@example.com',
        },
      });
      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.body);
      expect(json.fiat_payment).toBeDefined();
      expect(json.fiat_payment.authorizationUrl).toContain('checkout.mockbilling');
    });

    it('registers a buyer webhook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks',
        headers: { authorization: `Bearer ${validBuyerApiKey}` },
        payload: {
          url: 'https://buyer.example.com/webhook',
          event_types: ['observation.finalised'],
        },
      });
      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.body);
      expect(json.webhook_id).toBeDefined();
      expect(json.secret.startsWith('whsec_')).toBe(true);
    });

    it('enforces API key rate limiting with 429 Too Many Requests', async () => {
      // Create key with rate limit of 2 requests
      const testKey = 'mp_rate_limit_test_key';
      const keyHash = crypto.createHash('sha256').update(testKey).digest('hex');
      state.apiKeys.set(keyHash, {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Limited Key',
        key_hash: keyHash,
        key_prefix: 'mp_rate_',
        tier: 'trial',
        scopes: ['read:markets'],
        rate_limit_per_min: 2,
        is_active: true,
        created_at: new Date(),
      });

      // Hit 1
      const res1 = await app.inject({
        method: 'GET',
        url: '/v1/markets',
        headers: { authorization: `Bearer ${testKey}` },
      });
      expect(res1.statusCode).toBe(200);

      // Hit 2
      const res2 = await app.inject({
        method: 'GET',
        url: '/v1/markets',
        headers: { authorization: `Bearer ${testKey}` },
      });
      expect(res2.statusCode).toBe(200);

      // Hit 3 -> 429
      const res3 = await app.inject({
        method: 'GET',
        url: '/v1/markets',
        headers: { authorization: `Bearer ${testKey}` },
      });
      expect(res3.statusCode).toBe(429);
      expect(JSON.parse(res3.body).error).toBe('TooManyRequests');
    });

    it('enforces API key scope restrictions with 403 Forbidden', async () => {
      const scopedKey = 'mp_scoped_read_only_key';
      const keyHash = crypto.createHash('sha256').update(scopedKey).digest('hex');
      state.apiKeys.set(keyHash, {
        id: '00000000-0000-0000-0000-000000000003',
        name: 'Read Only Key',
        key_hash: keyHash,
        key_prefix: 'mp_read_',
        tier: 'trial',
        scopes: ['read:markets'], // lacks write:requests
        rate_limit_per_min: 60,
        is_active: true,
        created_at: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/requests',
        headers: { authorization: `Bearer ${scopedKey}` },
        payload: {
          data_type: 'RICE50',
          geohash: 's14b3k9x',
          bounty_usdc: 5.0,
        },
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).message).toContain('lacks required scope');
    });
  });

  describe('Reporter Endpoints (README §12 & §19)', () => {
    const testPhone = '+2348012345678';
    let reporterSessionToken: string;
    const testWallet = 'GBUYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA123';

    it('completes OTP request and verify cycle without storing plain phone', async () => {
      // 1. Request OTP
      const reqRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        payload: { phone: testPhone, country_code: 'NG' },
      });
      expect(reqRes.statusCode).toBe(200);
      const reqJson = JSON.parse(reqRes.body);
      expect(reqJson.phone_hash).toBeDefined();

      // Retrieve OTP sent by mock SMS provider
      const mockSms = state.services.sms as any;
      const lastOtp = mockSms.getLastOtp(testPhone);
      expect(lastOtp).toBeDefined();

      // 2. Verify with wrong OTP fails
      const failRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        payload: { phone_hash: reqJson.phone_hash, otp: '000000' },
      });
      expect(failRes.statusCode).toBe(400);

      // 3. Verify with correct OTP succeeds
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        payload: { phone_hash: reqJson.phone_hash, otp: lastOtp },
      });
      expect(verifyRes.statusCode).toBe(200);
      const verifyJson = JSON.parse(verifyRes.body);
      expect(verifyJson.session_token).toBeDefined();
      reporterSessionToken = verifyJson.session_token;

      // 4. Enroll reporter with passkey wallet
      const enrollRes = await app.inject({
        method: 'POST',
        url: '/v1/reporters',
        payload: {
          session_token: reporterSessionToken,
          wallet_address: testWallet,
        },
      });
      expect(enrollRes.statusCode).toBe(201);
      const enrollJson = JSON.parse(enrollRes.body);
      expect(enrollJson.wallet_address).toBe(testWallet);
      expect(enrollJson.reputation_score).toBe(100);
      expect(enrollJson.tier).toBe(1);
    });

    it('retrieves assigned tasks for authenticated reporter', async () => {
      // First enroll reporter
      const session = {
        token: 'test_rep_session',
        reporterId: 'rep_1',
        walletAddress: testWallet,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };
      state.reporterSessions.set(session.token, session);
      state.reporters.set(session.walletAddress, {
        id: 'rep_1',
        wallet_address: testWallet,
        phone_hash: 'hash',
        phone_salt: 'salt',
        country_code: 'NG',
        reputation_score: 120,
        tier: 1,
        status: 'active',
        stake_cap: '10000000',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/tasks',
        headers: { authorization: `Bearer ${session.token}` },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(Array.isArray(json.tasks)).toBe(true);
      expect(json.reputation_score).toBe(120);
    });

    it('uploads evidence: validates client SHA-256 and strips EXIF', async () => {
      const session = {
        token: 'test_rep_session_evidence',
        reporterId: 'rep_2',
        walletAddress: 'GREPORTER000000000000000000000000000000000000000000000002',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };
      state.reporterSessions.set(session.token, session);
      state.reporters.set(session.walletAddress, {
        id: 'rep_2',
        wallet_address: session.walletAddress,
        phone_hash: 'hash2',
        phone_salt: 'salt2',
        country_code: 'NG',
        reputation_score: 100,
        tier: 1,
        status: 'active',
        stake_cap: '10000000',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const rawContent = Buffer.from('RAW_EVIDENCE_PHOTO_BYTES');
      const validSha256 = crypto.createHash('sha256').update(rawContent).digest('hex');
      const base64Content = rawContent.toString('base64');

      // 1. Mismatch client SHA-256 returns 400
      const badRes = await app.inject({
        method: 'POST',
        url: '/v1/evidence',
        headers: { authorization: `Bearer ${session.token}` },
        payload: {
          request_id: '12345',
          client_sha256: '0000000000000000000000000000000000000000000000000000000000000000',
          content_base64: base64Content,
        },
      });
      expect(badRes.statusCode).toBe(400);

      // 2. Matching SHA-256 succeeds and returns EXIF-stripped link
      const goodRes = await app.inject({
        method: 'POST',
        url: '/v1/evidence',
        headers: { authorization: `Bearer ${session.token}` },
        payload: {
          request_id: '12345',
          client_sha256: validSha256,
          content_base64: base64Content,
        },
      });
      expect(goodRes.statusCode).toBe(201);
      const json = JSON.parse(goodRes.body);
      expect(json.evidence_hash).toBe(validSha256);
      expect(json.exif_stripped_url).toBeDefined();
    });

    it('submits transaction via Relayer for fee sponsorship', async () => {
      const session = {
        token: 'test_rep_session_relay',
        reporterId: 'rep_3',
        walletAddress: 'GREPORTER000000000000000000000000000000000000000000000003',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };
      state.reporterSessions.set(session.token, session);
      state.reporters.set(session.walletAddress, {
        id: 'rep_3',
        wallet_address: session.walletAddress,
        phone_hash: 'hash3',
        phone_salt: 'salt3',
        country_code: 'NG',
        reputation_score: 100,
        tier: 1,
        status: 'active',
        stake_cap: '10000000',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/relay',
        headers: { authorization: `Bearer ${session.token}` },
        payload: {
          transaction_xdr: 'AAAA_SOROBAN_SIGNED_COMMIT_TRANSACTION',
        },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.success).toBe(true);
      expect(json.envelope_xdr).toContain('FEE_BUMP_');
    });

    it('retrieves earnings, balances, and slash history with reason codes', async () => {
      const wallet = 'GREPORTER000000000000000000000000000000000000000000000004';
      const session = {
        token: 'test_rep_session_earnings',
        reporterId: 'rep_4',
        walletAddress: wallet,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };
      state.reporterSessions.set(session.token, session);
      state.reporters.set(wallet, {
        id: 'rep_4',
        wallet_address: wallet,
        phone_hash: 'hash4',
        phone_salt: 'salt4',
        country_code: 'NG',
        reputation_score: 95,
        tier: 1,
        status: 'active',
        stake_cap: '10000000',
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Add payout history with slash reason
      state.payouts.set(wallet, [
        {
          id: 'payout_1',
          request_id: '12345',
          reporter_address: wallet,
          bounty_reward: '0',
          stake_returned: '2000000', // 0.20 USDC
          slash_bonus: '0',
          slash_penalty: '500000', // 0.05 USDC gentle outlier slash
          reason_code: 'OUTLIER',
          claimed: true,
          claimed_at: new Date(),
          created_at: new Date(),
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/earnings',
        headers: { authorization: `Bearer ${session.token}` },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.balances.total_slashed_stroops).toBe('500000');
      expect(json.payout_history[0].reason_code).toBe('OUTLIER');
    });
  });

  describe('Admin Endpoints & Audit Logging', () => {
    it('rejects unauthorized admin access with 401/403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/reporters/some_id/suspend',
        payload: { reason: 'Suspicious activity' },
      });
      expect(res.statusCode).toBe(401);

      const badKeyRes = await app.inject({
        method: 'POST',
        url: '/v1/admin/reporters/some_id/suspend',
        headers: { 'x-admin-key': 'wrong_admin_key' },
        payload: { reason: 'Suspicious activity' },
      });
      expect(badKeyRes.statusCode).toBe(403);
    });

    it('suspends reporter and records immutable audit log', async () => {
      const repWallet = 'GREPORTER_SUSPEND_TEST_000000000000000000000000000000001';
      state.reporters.set('rep_suspend_1', {
        id: 'rep_suspend_1',
        wallet_address: repWallet,
        phone_hash: 'ph_hash',
        phone_salt: 'salt',
        country_code: 'NG',
        reputation_score: 50,
        tier: 1,
        status: 'active',
        stake_cap: '10000000',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/reporters/rep_suspend_1/suspend',
        headers: {
          'x-admin-key': adminSecret,
          'x-admin-address': 'GADMIN000000000000000000000000000000000000000000000000',
        },
        payload: {
          action: 'suspend',
          reason: 'Duplicate photo evidence identified by automated clustering',
        },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.new_status).toBe('suspended');

      // Verify audit log entry
      expect(state.adminActions.length).toBe(1);
      expect(state.adminActions[0].action).toBe('suspend_reporter');
      expect(state.adminActions[0].target_id).toBe('rep_suspend_1');
    });

    it('schedules ground-truth audit and records audit log', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/audits/schedule',
        headers: { 'x-admin-key': adminSecret },
        payload: {
          request_id: '12345',
          sample_rate_bps: 1000,
          notes: 'High bounty request sampled for physical inspection',
        },
      });
      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.body);
      expect(json.status).toBe('scheduled');
      expect(state.audits.length).toBe(1);
      expect(state.adminActions.some((a) => a.action === 'schedule_audit')).toBe(true);
    });

    it('registers data type and records audit log', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/datatypes',
        headers: { 'x-admin-key': adminSecret },
        payload: {
          code: 'POWER',
          description: 'Grid outage status at location',
          unit: 'hours',
          tolerance_bps: 0,
          enabled: true,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(state.adminActions.some((a) => a.action === 'add_datatype')).toBe(true);
    });
  });
});
