import http from 'node:http';
import { Registry, Gauge, Counter } from 'prom-client';

export class WorkerMetrics {
  public registry: Registry;
  public indexerLag: Gauge;
  public resolutionBacklog: Gauge;
  public relayerBalanceUsdc: Gauge;
  public jobsProcessed: Counter;
  public errorRates: Counter;
  private server?: http.Server;

  constructor() {
    this.registry = new Registry();

    // 1. Indexer lag (README §23)
    this.indexerLag = new Gauge({
      name: 'indexer_lag_ledgers',
      help: 'Lag in ledgers between Stellar chain head and latest indexed event cursor',
      registers: [this.registry],
    });

    // 2. Resolution backlog (README §23)
    this.resolutionBacklog = new Gauge({
      name: 'resolution_backlog_total',
      help: 'Number of open/revealing requests past reveal_deadline awaiting contract resolution',
      registers: [this.registry],
    });

    // 3. Relayer balance (README §23)
    this.relayerBalanceUsdc = new Gauge({
      name: 'relayer_balance_usdc',
      help: 'Fee-sponsoring relayer USDC treasury balance',
      registers: [this.registry],
    });

    // 4. Jobs processed
    this.jobsProcessed = new Counter({
      name: 'worker_jobs_processed_total',
      help: 'Total BullMQ queue jobs processed by worker instance',
      labelNames: ['job_type', 'status'],
      registers: [this.registry],
    });

    // 5. Error rates (README §23)
    this.errorRates = new Counter({
      name: 'worker_error_rates_total',
      help: 'Total error count encountered during indexing and queue processing',
      labelNames: ['component'],
      registers: [this.registry],
    });
  }

  public async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  public async startServer(port = 9090, host = '0.0.0.0'): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.url === '/metrics' && req.method === 'GET') {
          try {
            const metrics = await this.getMetricsText();
            res.writeHead(200, { 'Content-Type': this.registry.contentType });
            res.end(metrics);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(err instanceof Error ? err.message : String(err));
          }
        } else if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });

      this.server.listen(port, host, () => {
        resolve(this.server!);
      });
      this.server.on('error', reject);
    });
  }

  public async stopServer(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = undefined;
    }
  }
}
