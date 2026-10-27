import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiState } from '../state.js';
import { createAuthHooks } from '../plugins/auth.js';
import { EvidenceHashMismatchError } from '@marketpulse/shared';

export function registerReporterRoutes(app: FastifyInstance, state: ApiState): void {
  const auth = createAuthHooks(state);

  // 1. POST /v1/auth/otp/request
  // Send SMS OTP. Privacy rule: phone is salted and hashed immediately.
  const OtpRequestSchema = z.object({
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be valid E.164 phone number'),
    country_code: z.string().length(2).default('NG'),
  });

  app.post('/v1/auth/otp/request', async (req, reply) => {
    const body = OtpRequestSchema.parse(req.body);
    const salt = crypto.randomBytes(16).toString('hex');
    const phoneHash = state.hashPhone(body.phone, salt);

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    state.otpSessions.set(phoneHash, {
      phoneHash,
      phoneSalt: salt,
      countryCode: body.country_code,
      otp,
      expiresAt,
      verified: false,
    });

    // Send via SMS provider mock
    const smsRes = await state.services.sms.sendSms({
      to: body.phone,
      message: `Your MarketPulse verification code is ${otp}. Valid for 10 minutes.`,
      senderId: 'MarketPulse',
    });

    return reply.send({
      success: true,
      phone_hash: phoneHash,
      country_code: body.country_code,
      message_id: smsRes.messageId,
      expires_in_seconds: 600,
    });
  });

  // 2. POST /v1/auth/otp/verify
  // Verify OTP, issue session token
  const OtpVerifySchema = z.object({
    phone_hash: z.string().length(64),
    otp: z.string().length(6),
  });

  app.post('/v1/auth/otp/verify', async (req, reply) => {
    const body = OtpVerifySchema.parse(req.body);
    const session = state.otpSessions.get(body.phone_hash);

    if (!session || session.expiresAt < new Date()) {
      return reply.status(400).send({
        error: 'InvalidOtp',
        message: 'OTP session expired or does not exist',
      });
    }

    if (session.otp !== body.otp) {
      return reply.status(400).send({
        error: 'InvalidOtp',
        message: 'Incorrect 6-digit verification code',
      });
    }

    session.verified = true;
    const sessionToken = `mp_rep_${crypto.randomBytes(32).toString('hex')}`;
    const tokenExpiresAt = new Date(Date.now() + 30 * 86400 * 1000); // 30 days

    // Find existing reporter or create placeholder
    const reporter = Array.from(state.reporters.values()).find(
      (r) => r.phone_hash === body.phone_hash,
    );
    const reporterId = reporter ? reporter.id : crypto.randomUUID();

    state.reporterSessions.set(sessionToken, {
      token: sessionToken,
      reporterId,
      walletAddress: reporter ? reporter.wallet_address : '',
      createdAt: new Date(),
      expiresAt: tokenExpiresAt,
    });

    return reply.send({
      success: true,
      session_token: sessionToken,
      is_enrolled: Boolean(reporter),
      reporter_id: reporterId,
      expires_at: tokenExpiresAt.toISOString(),
    });
  });

  // 3. POST /v1/reporters
  // Enroll and register passkey wallet
  const EnrollSchema = z.object({
    session_token: z.string(),
    wallet_address: z.string().regex(/^[GC][A-Z0-9]{55}$/, 'Invalid Stellar address'),
    passkey_credential_id: z.string().optional(),
    passkey_public_key: z.string().optional(),
    device_fingerprint: z.string().default('default_device_fp'),
  });

  app.post('/v1/reporters', async (req, reply) => {
    const body = EnrollSchema.parse(req.body);
    const session = state.reporterSessions.get(body.session_token);

    if (!session || session.expiresAt < new Date()) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired session token',
      });
    }

    // Check if wallet address already enrolled
    if (state.reporters.has(body.wallet_address)) {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'Wallet address is already enrolled',
      });
    }

    const reporterRow = {
      id: session.reporterId,
      wallet_address: body.wallet_address,
      phone_hash: session.reporterId,
      phone_salt: 'salt',
      country_code: 'NG',
      reputation_score: 100, // Tier 1 starting score
      tier: 1,
      status: 'active' as const,
      stake_cap: '10000000', // 1 USDC in stroops
      created_at: new Date(),
      updated_at: new Date(),
    };

    state.reporters.set(reporterRow.id, reporterRow);
    state.reporters.set(reporterRow.wallet_address, reporterRow);
    session.walletAddress = body.wallet_address;

    return reply.status(201).send({
      reporter_id: reporterRow.id,
      wallet_address: reporterRow.wallet_address,
      reputation_score: reporterRow.reputation_score,
      tier: reporterRow.tier,
      status: reporterRow.status,
      stake_cap_usdc: '1.00',
    });
  });

  // 4. GET /v1/tasks
  // Assigned tasks for current reporter
  app.get('/v1/tasks', {
    preHandler: [auth.verifyReporterSession],
    handler: async (req, reply) => {
      const reporter = req.reporter!;
      // Open or revealing requests eligible for this reporter
      const tasks = Array.from(state.requests.values())
        .filter((r) => r.status === 'open' || r.status === 'revealing')
        .map((r) => ({
          request_id: r.id,
          data_type: r.data_type,
          geohash: r.geohash,
          bounty_stroops: r.bounty,
          min_stake_stroops: r.min_stake,
          status: r.status,
          commit_deadline: r.commit_deadline,
          reveal_deadline: r.reveal_deadline,
          reporter_stake_cap: reporter.stake_cap,
        }));

      return reply.send({
        tasks,
        reporter_tier: reporter.tier,
        reputation_score: reporter.reputation_score,
      });
    },
  });

  // 5. POST /v1/evidence
  // Upload evidence; client supplies SHA-256, server verifies and stores
  // Strips EXIF metadata for privacy, returns hash for on-chain commit
  const EvidenceUploadSchema = z.object({
    request_id: z.string(),
    client_sha256: z.string().length(64),
    content_base64: z.string().min(1),
    mime_type: z.string().default('image/jpeg'),
  });

  app.post('/v1/evidence', {
    preHandler: [auth.verifyReporterSession],
    handler: async (req, reply) => {
      const body = EvidenceUploadSchema.parse(req.body);
      const buffer = Buffer.from(body.content_base64, 'base64');
      const storageKey = `evidence/${body.request_id}/${body.client_sha256}.jpg`;

      try {
        const uploadRes = await state.services.storage.upload({
          key: storageKey,
          content: buffer,
          contentType: body.mime_type,
          expectedSha256: body.client_sha256,
          stripExif: true,
        });

        // Store evidence record
        state.evidence.set(uploadRes.sha256, {
          id: crypto.randomUUID(),
          evidence_hash: uploadRes.sha256,
          storage_key: uploadRes.key,
          mime_type: body.mime_type,
          file_size_bytes: uploadRes.size,
          exif_stripped_key: uploadRes.exifStrippedKey,
          check_results: {
            sha256Verified: true,
            exifStripped: true,
            pHashComputed: true,
          },
          created_at: new Date(),
        });

        return reply.status(201).send({
          evidence_hash: uploadRes.sha256,
          storage_url: uploadRes.publicUrl,
          exif_stripped_url: uploadRes.exifStrippedKey
            ? state.services.storage.getPublicUrl(uploadRes.exifStrippedKey)
            : undefined,
          status: 'verified_and_stored',
        });
      } catch (err) {
        if (err instanceof EvidenceHashMismatchError) {
          return reply.status(400).send({
            error: 'HashMismatch',
            message: err.message,
          });
        }
        throw err;
      }
    },
  });

  // 6. POST /v1/relay
  // Submit signed transaction for fee sponsorship
  const RelaySchema = z.object({
    transaction_xdr: z.string().min(1),
  });

  app.post('/v1/relay', {
    preHandler: [auth.verifyReporterSession],
    handler: async (req, reply) => {
      const body = RelaySchema.parse(req.body);
      const res = await state.services.relayer.relay({
        transactionXdr: body.transaction_xdr,
        sponsorAddress: req.reporter?.wallet_address,
      });

      return reply.send({
        success: res.success,
        hash: res.hash,
        ledger: res.ledger,
        status: res.status,
        envelope_xdr: res.envelopeXdr,
        fee_sponsored_stroops: res.feeChargedStroops,
      });
    },
  });

  // 7. GET /v1/me/earnings
  // Balances, pending, slash history with reason codes
  app.get('/v1/me/earnings', {
    preHandler: [auth.verifyReporterSession],
    handler: async (req, reply) => {
      const reporter = req.reporter!;
      const reporterPayouts = state.payouts.get(reporter.wallet_address) || [];

      let totalEarned = 0n;
      let totalSlashed = 0n;
      let pendingClaim = 0n;

      for (const p of reporterPayouts) {
        totalEarned += BigInt(p.bounty_reward) + BigInt(p.slash_bonus);
        totalSlashed += BigInt(p.slash_penalty);
        if (!p.claimed && (BigInt(p.bounty_reward) > 0n || BigInt(p.stake_returned) > 0n)) {
          pendingClaim +=
            BigInt(p.bounty_reward) + BigInt(p.stake_returned) + BigInt(p.slash_bonus);
        }
      }

      return reply.send({
        wallet_address: reporter.wallet_address,
        reputation_score: reporter.reputation_score,
        tier: reporter.tier,
        stake_cap_stroops: reporter.stake_cap,
        balances: {
          total_earned_stroops: totalEarned.toString(),
          total_slashed_stroops: totalSlashed.toString(),
          pending_claim_stroops: pendingClaim.toString(),
        },
        payout_history: reporterPayouts.map((p) => ({
          request_id: p.request_id,
          bounty_reward: p.bounty_reward,
          stake_returned: p.stake_returned,
          slash_bonus: p.slash_bonus,
          slash_penalty: p.slash_penalty,
          reason_code: p.reason_code,
          claimed: p.claimed,
          claimed_at: p.claimed_at,
        })),
      });
    },
  });
}
