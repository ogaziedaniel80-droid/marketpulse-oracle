import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiState } from '../state.js';
import { createAuthHooks } from '../plugins/auth.js';
import { LAUNCH_DATA_TYPES, PLANNED_DATA_TYPES } from '@marketpulse/shared';

export function registerBuyerRoutes(app: FastifyInstance, state: ApiState): void {
  const auth = createAuthHooks(state);

  // 1. GET /v1/observations
  // Query finalised observations by data_type, geohash prefix, date range
  const ObservationsQuerySchema = z.object({
    data_type: z.string().optional(),
    geohash: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
  });

  app.get('/v1/observations', {
    preHandler: [auth.verifyBuyerApiKey('read:observations')],
    handler: async (req, reply) => {
      const query = ObservationsQuerySchema.parse(req.query);
      let results = Array.from(state.observations.values());

      if (query.data_type) {
        results = results.filter(
          (o) => o.data_type.toUpperCase() === query.data_type!.toUpperCase(),
        );
      }
      if (query.geohash) {
        results = results.filter((o) => o.geohash.startsWith(query.geohash!));
      }
      if (query.start_date) {
        const start = new Date(query.start_date).getTime();
        results = results.filter((o) => new Date(o.finalised_at).getTime() >= start);
      }
      if (query.end_date) {
        const end = new Date(query.end_date).getTime();
        results = results.filter((o) => new Date(o.finalised_at).getTime() <= end);
      }

      // Sort most recent first
      results.sort(
        (a, b) => new Date(b.finalised_at).getTime() - new Date(a.finalised_at).getTime(),
      );

      const paginated = results.slice(query.offset, query.offset + query.limit);

      return reply.send({
        total: results.length,
        limit: query.limit,
        offset: query.offset,
        data: paginated.map((obs) => ({
          request_id: obs.request_id,
          data_type: obs.data_type,
          market: obs.market_id,
          geohash: obs.geohash,
          value: obs.value,
          decimals: obs.decimals,
          currency: obs.currency,
          n_reports: obs.n_reports,
          confidence_bps: obs.confidence_bps,
          finalised_at:
            obs.finalised_at instanceof Date ? obs.finalised_at.toISOString() : obs.finalised_at,
          challenge_status: obs.challenge_status,
          evidence_bundle_url: obs.evidence_bundle_url,
        })),
      });
    },
  });

  // 2. GET /v1/observations/latest
  // Latest observation for a data type and market
  const LatestQuerySchema = z.object({
    data_type: z.string(),
    market: z.string().optional(),
    geohash: z.string().optional(),
  });

  app.get('/v1/observations/latest', {
    preHandler: [auth.verifyBuyerApiKey('read:observations')],
    handler: async (req, reply) => {
      const query = LatestQuerySchema.parse(req.query);
      const observations = Array.from(state.observations.values())
        .filter((obs) => {
          if (obs.data_type.toUpperCase() !== query.data_type.toUpperCase()) return false;
          if (query.market && obs.market_id !== query.market) return false;
          if (query.geohash && !obs.geohash.startsWith(query.geohash)) return false;
          return true;
        })
        .sort((a, b) => new Date(b.finalised_at).getTime() - new Date(a.finalised_at).getTime());

      if (observations.length === 0) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `No observation found for data_type=${query.data_type}`,
        });
      }

      const obs = observations[0];
      return reply.send({
        data_type: obs.data_type,
        market: obs.market_id || 'unknown',
        geohash: obs.geohash,
        value: obs.value,
        decimals: obs.decimals,
        currency: obs.currency,
        n_reports: obs.n_reports,
        confidence_bps: obs.confidence_bps,
        finalised_at:
          obs.finalised_at instanceof Date ? obs.finalised_at.toISOString() : obs.finalised_at,
        request_id: obs.request_id,
        challenge_status: obs.challenge_status,
        evidence_bundle_url: obs.evidence_bundle_url,
      });
    },
  });

  // 3. GET /v1/markets
  // List supported markets with geohash and metadata
  app.get('/v1/markets', {
    preHandler: [auth.verifyBuyerApiKey('read:markets')],
    handler: async (_req, reply) => {
      const list = Array.from(state.markets.values());
      return reply.send({
        count: list.length,
        markets: list.map((m) => ({
          id: m.id,
          name: m.name,
          city: m.city,
          country_code: m.country_code,
          geohash: m.geohash,
          metadata: m.metadata,
        })),
      });
    },
  });

  // 4. GET /v1/datatypes
  // Supported data types, units, and tolerances
  app.get('/v1/datatypes', {
    preHandler: [auth.verifyBuyerApiKey('read:datatypes')],
    handler: async (_req, reply) => {
      return reply.send({
        launch_types: LAUNCH_DATA_TYPES,
        planned_types: PLANNED_DATA_TYPES,
      });
    },
  });

  // 5. POST /v1/requests
  // Create a data request (fiat-funded or USDC)
  const CreateRequestSchema = z.object({
    data_type: z.string(),
    geohash: z.string().min(4).max(12),
    bounty_usdc: z.number().positive(),
    funding_method: z
      .enum(['usdc_onchain', 'fiat_paystack', 'fiat_flutterwave'])
      .default('usdc_onchain'),
    buyer_email: z.string().email().optional(),
    tolerance_bps: z.number().int().min(100).max(3000).default(800), // default 8%
    min_reports: z.number().int().min(3).max(15).default(5),
    max_reports: z.number().int().min(5).max(15).default(15),
    challenge_window_seconds: z.number().int().min(60).default(3600),
  });

  app.post('/v1/requests', {
    preHandler: [auth.verifyBuyerApiKey('write:requests')],
    handler: async (req, reply) => {
      const body = CreateRequestSchema.parse(req.body);
      const requestId = Date.now().toString();

      let fiatPaymentInfo;
      if (body.funding_method.startsWith('fiat_')) {
        if (!body.buyer_email) {
          return reply.status(400).send({
            error: 'BadRequest',
            message: 'buyer_email is required for fiat billing',
          });
        }
        // Minor unit conversion (e.g. $1 = 100 cents / NGN 1500 per USD)
        const amountKobo = Math.round(body.bounty_usdc * 1500 * 100);
        fiatPaymentInfo = await state.services.billing.initializePayment({
          email: body.buyer_email,
          amountMinorUnit: amountKobo,
          currency: 'NGN',
          metadata: { requestId, data_type: body.data_type, geohash: body.geohash },
        });
      }

      const commitDeadline = new Date(Date.now() + 3600 * 1000);
      const revealDeadline = new Date(Date.now() + 7200 * 1000);

      const requestRow = {
        id: requestId,
        requester: req.apiKey ? `KEY:${req.apiKey.id}` : 'ANONYMOUS',
        data_type: body.data_type,
        geohash: body.geohash,
        bounty: Math.round(body.bounty_usdc * 10000000).toString(),
        token: 'CUSDC0000000000000000000000000000000000000000000000000',
        min_stake: '2500000',
        tolerance_bps: body.tolerance_bps,
        commit_deadline: commitDeadline,
        reveal_deadline: revealDeadline,
        challenge_window: body.challenge_window_seconds.toString(),
        min_reports: body.min_reports,
        max_reports: body.max_reports,
        status: 'open' as const,
        created_ledger: '100001',
        created_at: new Date(),
        updated_at: new Date(),
      };

      state.requests.set(requestId, requestRow);

      return reply.status(201).send({
        request_id: requestId,
        status: 'open',
        data_type: body.data_type,
        geohash: body.geohash,
        bounty_usdc: body.bounty_usdc,
        commit_deadline: commitDeadline.toISOString(),
        reveal_deadline: revealDeadline.toISOString(),
        min_reports: body.min_reports,
        max_reports: body.max_reports,
        fiat_payment: fiatPaymentInfo,
      });
    },
  });

  // 6. GET /v1/requests/:id
  // Request status, report counts, resolution
  app.get('/v1/requests/:id', {
    preHandler: [auth.verifyBuyerApiKey('read:observations')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = state.requests.get(id);

      if (!request) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Request ${id} not found`,
        });
      }

      const reports = state.reports.get(id) || [];
      const obs = state.observations.get(id);

      return reply.send({
        id: request.id,
        requester: request.requester,
        data_type: request.data_type,
        geohash: request.geohash,
        bounty: request.bounty,
        min_stake: request.min_stake,
        tolerance_bps: request.tolerance_bps,
        status: request.status,
        commit_deadline: request.commit_deadline,
        reveal_deadline: request.reveal_deadline,
        min_reports: request.min_reports,
        max_reports: request.max_reports,
        report_counts: {
          committed: reports.length,
          revealed: reports.filter((r) => r.revealed).length,
          accepted: reports.filter((r) => r.outcome === 'accepted').length,
          slashed: reports.filter((r) => r.outcome.includes('slashed')).length,
        },
        observation: obs
          ? {
              value: obs.value,
              confidence_bps: obs.confidence_bps,
              finalised_at: obs.finalised_at,
              challenge_status: obs.challenge_status,
            }
          : null,
      });
    },
  });

  // 7. POST /v1/webhooks
  // Subscribe to events (observation finalised, request cancelled)
  const CreateWebhookSchema = z.object({
    url: z.string().url(),
    event_types: z.array(z.string()).min(1).default(['observation.finalised', 'request.cancelled']),
  });

  app.post('/v1/webhooks', {
    preHandler: [auth.verifyBuyerApiKey('write:webhooks')],
    handler: async (req, reply) => {
      const body = CreateWebhookSchema.parse(req.body);
      const webhookId = crypto.randomUUID();
      const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

      const row = {
        id: webhookId,
        api_key_id: req.apiKey?.id,
        url: body.url,
        event_types: body.event_types,
        secret,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      state.webhooks.push(row);

      return reply.status(201).send({
        webhook_id: webhookId,
        url: body.url,
        event_types: body.event_types,
        secret,
        status: 'active',
      });
    },
  });
}
