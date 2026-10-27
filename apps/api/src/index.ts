import { buildServer } from './server.js';

export * from './server.js';
export * from './state.js';

async function main() {
  const port = Number(process.env.PORT) || 4000;
  const host = process.env.HOST || '0.0.0.0';
  const server = buildServer({ logger: true });

  try {
    await server.listen({ port, host });
    console.log(`MarketPulse Oracle API server listening on http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  main();
}
