import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ApiState } from '../state.js';
import type { ApiKeyRow, ReporterRow } from '@marketpulse/shared';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyRow;
    reporter?: ReporterRow;
    adminAddress?: string;
  }
}

export function createAuthHooks(state: ApiState) {
  return {
    /**
     * Buyer Authentication via API Key
     * Header: Authorization: Bearer <api_key> or x-api-key: <api_key>
     */
    verifyBuyerApiKey: (requiredScope?: string) => {
      return async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || (req.headers['x-api-key'] as string);
        if (!authHeader) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Missing API key in Authorization or x-api-key header',
          });
        }

        const rawKey = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : authHeader.trim();
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const apiKey = state.apiKeys.get(keyHash);

        if (!apiKey || !apiKey.is_active) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid or revoked API key',
          });
        }

        // Scope check
        if (
          requiredScope &&
          !apiKey.scopes.includes(requiredScope) &&
          !apiKey.scopes.includes('*')
        ) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: `API key lacks required scope: ${requiredScope}`,
          });
        }

        // Rate limiting check
        const now = Date.now();
        const minuteKey = `${apiKey.id}:${Math.floor(now / 60000)}`;
        const hit = state.rateLimitHits.get(minuteKey) || {
          count: 0,
          resetAt: Math.ceil(now / 60000) * 60000,
        };

        if (hit.count >= apiKey.rate_limit_per_min) {
          reply.header('X-RateLimit-Limit', apiKey.rate_limit_per_min);
          reply.header('X-RateLimit-Remaining', 0);
          reply.header('X-RateLimit-Reset', Math.ceil(hit.resetAt / 1000));
          return reply.status(429).send({
            error: 'TooManyRequests',
            message: `Rate limit of ${apiKey.rate_limit_per_min} requests per minute exceeded`,
          });
        }

        hit.count += 1;
        state.rateLimitHits.set(minuteKey, hit);

        reply.header('X-RateLimit-Limit', apiKey.rate_limit_per_min);
        reply.header('X-RateLimit-Remaining', Math.max(0, apiKey.rate_limit_per_min - hit.count));
        reply.header('X-RateLimit-Reset', Math.ceil(hit.resetAt / 1000));

        apiKey.last_used_at = new Date();
        req.apiKey = apiKey;
      };
    },

    /**
     * Reporter Authentication via Session Bearer Token
     */
    verifyReporterSession: async (req: FastifyRequest, reply: FastifyReply) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid Bearer token for reporter session',
        });
      }

      const token = authHeader.slice(7).trim();
      const session = state.reporterSessions.get(token);

      if (!session || session.expiresAt < new Date()) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Reporter session has expired or is invalid',
        });
      }

      const reporter =
        state.reporters.get(session.reporterId) || state.reporters.get(session.walletAddress);
      if (!reporter) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Reporter record not found',
        });
      }

      if (reporter.status === 'suspended' || reporter.status === 'banned') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `Reporter account is ${reporter.status}`,
        });
      }

      req.reporter = reporter;
    },

    /**
     * Restricted Admin Authentication with Audit Logging
     */
    verifyAdminAuth: async (req: FastifyRequest, reply: FastifyReply) => {
      const authHeader = req.headers.authorization || (req.headers['x-admin-key'] as string);
      if (!authHeader) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Admin authorization key required',
        });
      }

      const rawKey = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : authHeader.trim();
      if (rawKey !== state.adminKey) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Invalid administrative credential',
        });
      }

      req.adminAddress =
        (req.headers['x-admin-address'] as string) ||
        'GADMIN000000000000000000000000000000000000000000000000';
    },
  };
}
