import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiState } from '../state.js';
import { createAuthHooks } from '../plugins/auth.js';

export function registerAdminRoutes(app: FastifyInstance, state: ApiState): void {
  const auth = createAuthHooks(state);

  // 1. POST /v1/admin/reporters/:id/suspend
  // Restricted, audit-logged action: suspend or reinstate a reporter
  const SuspendSchema = z.object({
    action: z.enum(['suspend', 'reinstate']).default('suspend'),
    reason: z.string().min(5),
  });

  app.post('/v1/admin/reporters/:id/suspend', {
    preHandler: [auth.verifyAdminAuth],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = SuspendSchema.parse(req.body);

      const reporter = state.reporters.get(id);
      if (!reporter) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Reporter ${id} not found`,
        });
      }

      reporter.status = body.action === 'suspend' ? 'suspended' : 'active';
      reporter.updated_at = new Date();

      // Audit log entry
      const auditLog = state.logAdminAction(
        req.adminAddress!,
        body.action === 'suspend' ? 'suspend_reporter' : 'reinstate_reporter',
        id,
        { reason: body.reason, previous_status: reporter.status },
      );

      return reply.send({
        success: true,
        reporter_id: reporter.id,
        new_status: reporter.status,
        audit_log_id: auditLog.id,
      });
    },
  });

  // 2. GET /v1/admin/flags
  // Restricted: review flags (evidence, geo, correlation)
  const FlagsQuerySchema = z.object({
    reviewed: z.enum(['true', 'false']).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  });

  app.get('/v1/admin/flags', {
    preHandler: [auth.verifyAdminAuth],
    handler: async (req, reply) => {
      const query = FlagsQuerySchema.parse(req.query);
      let flags = [...state.flags];

      if (query.reviewed !== undefined) {
        const isReviewed = query.reviewed === 'true';
        flags = flags.filter((f) => f.reviewed === isReviewed);
      }
      if (query.severity) {
        flags = flags.filter((f) => f.severity === query.severity);
      }

      return reply.send({
        count: flags.length,
        flags,
      });
    },
  });

  // 3. POST /v1/admin/audits/schedule
  // Restricted, audit-logged: schedule ground-truth audit
  const ScheduleAuditSchema = z.object({
    request_id: z.string(),
    sample_rate_bps: z.number().int().min(100).max(10000).default(500),
    auditor_address: z.string().optional(),
    notes: z.string().optional(),
  });

  app.post('/v1/admin/audits/schedule', {
    preHandler: [auth.verifyAdminAuth],
    handler: async (req, reply) => {
      const body = ScheduleAuditSchema.parse(req.body);
      const auditId = crypto.randomUUID();

      const auditRow = {
        id: auditId,
        request_id: body.request_id,
        sample_rate_bps: body.sample_rate_bps,
        auditor_address: body.auditor_address || null,
        status: 'scheduled' as const,
        notes: body.notes || null,
        created_at: new Date(),
      };

      state.audits.push(auditRow);

      const auditLog = state.logAdminAction(req.adminAddress!, 'schedule_audit', auditId, {
        request_id: body.request_id,
        sample_rate_bps: body.sample_rate_bps,
      });

      return reply.status(201).send({
        audit_id: auditId,
        request_id: body.request_id,
        status: 'scheduled',
        audit_log_id: auditLog.id,
      });
    },
  });

  // 4. POST /v1/admin/datatypes
  // Restricted, audit-logged: register or update data type
  const ManageDataTypeSchema = z.object({
    code: z.string().min(2).max(16),
    description: z.string(),
    unit: z.string(),
    tolerance_bps: z.number().int(),
    enabled: z.boolean().default(true),
  });

  app.post('/v1/admin/datatypes', {
    preHandler: [auth.verifyAdminAuth],
    handler: async (req, reply) => {
      const body = ManageDataTypeSchema.parse(req.body);

      const auditLog = state.logAdminAction(req.adminAddress!, 'add_datatype', body.code, body);

      return reply.status(201).send({
        success: true,
        code: body.code,
        enabled: body.enabled,
        audit_log_id: auditLog.id,
      });
    },
  });
}
