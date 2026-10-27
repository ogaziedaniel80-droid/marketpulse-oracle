import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import { ApiState } from './state.js';
import { registerBuyerRoutes } from './routes/buyer.js';
import { registerReporterRoutes } from './routes/reporter.js';
import { registerAdminRoutes } from './routes/admin.js';

export interface ServerOptions {
  state?: ApiState;
  logger?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  const state = options.state || new ApiState();

  // Register CORS
  app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Health check
  app.get('/health', async () => ({ status: 'healthy', timestamp: new Date().toISOString() }));

  // Register all routes
  registerBuyerRoutes(app, state);
  registerReporterRoutes(app, state);
  registerAdminRoutes(app, state);

  // Global error handler
  app.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid request payload or query parameters',
        details: (error as unknown as { issues?: unknown }).issues || error.message,
      });
    }
    const statusCode = (error as FastifyError).statusCode || 500;
    reply.status(statusCode).send({
      error: error.name || 'InternalServerError',
      message: error.message || 'An unexpected error occurred',
    });
  });

  return app;
}
