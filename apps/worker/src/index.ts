import { MockStellarRpcClient } from './indexer/mock-rpc.js';
import { EventIndexer, InMemoryIndexerStateStore } from './indexer/indexer.js';
import { WorkerQueueProcessor } from './queues/queue.js';
import { LeaderElection } from './leader/election.js';
import { WorkerMetrics } from './metrics/metrics.js';
import { createServiceContainer } from '@marketpulse/shared';

export * from './indexer/types.js';
export * from './indexer/mock-rpc.js';
export * from './indexer/indexer.js';
export * from './queues/types.js';
export * from './queues/queue.js';
export * from './leader/election.js';
export * from './metrics/metrics.js';

export class WorkerDaemon {
  public rpcClient: MockStellarRpcClient;
  public indexer: EventIndexer;
  public store: InMemoryIndexerStateStore;
  public queue: WorkerQueueProcessor;
  public election: LeaderElection;
  public metrics: WorkerMetrics;
  private running = false;
  private pollInterval?: NodeJS.Timeout;

  constructor(instanceId = `worker_${Date.now()}`) {
    const services = createServiceContainer();
    this.rpcClient = new MockStellarRpcClient();
    this.store = new InMemoryIndexerStateStore();
    this.indexer = new EventIndexer(this.rpcClient, this.store);
    this.queue = new WorkerQueueProcessor(services);
    this.election = new LeaderElection({ instanceId });
    this.metrics = new WorkerMetrics();
  }

  public async start(metricsPort = 9090): Promise<void> {
    this.running = true;
    await this.metrics.startServer(metricsPort);
    await this.election.acquire();
    this.election.startHeartbeat();

    // Start indexer polling loop
    this.pollInterval = setInterval(async () => {
      if (!this.running) return;
      try {
        const { lag } = await this.indexer.pollEvents();
        this.metrics.indexerLag.set(lag);
      } catch (err) {
        this.metrics.errorRates.inc({ component: 'indexer' });
      }
    }, 1000);
    if (this.pollInterval.unref) {
      this.pollInterval.unref();
    }
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    this.election.stopHeartbeat();
    await this.election.release();
    await this.metrics.stopServer();
  }
}

async function main() {
  const instanceId = process.env.INSTANCE_ID || `worker_${process.pid}`;
  const metricsPort = Number(process.env.METRICS_PORT) || 9090;
  const daemon = new WorkerDaemon(instanceId);

  console.log(`Starting MarketPulse Worker Daemon (${instanceId})...`);
  await daemon.start(metricsPort);
  console.log(`Worker running. Metrics available at http://localhost:${metricsPort}/metrics`);
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  main();
}
