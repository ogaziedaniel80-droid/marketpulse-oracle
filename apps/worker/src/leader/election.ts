import { Redis } from 'ioredis';

export interface LeaderElectionOptions {
  instanceId: string;
  leaseDurationMs?: number;
  lockKey?: string;
  redisUrl?: string;
  redisClient?: Redis;
  onElected?: () => void;
  onDemoted?: () => void;
}

export class SharedLockRegistry {
  private static instance: SharedLockRegistry;
  private locks = new Map<string, { instanceId: string; expiresAt: number }>();

  public static getInstance(): SharedLockRegistry {
    if (!SharedLockRegistry.instance) {
      SharedLockRegistry.instance = new SharedLockRegistry();
    }
    return SharedLockRegistry.instance;
  }

  public tryAcquire(key: string, instanceId: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.locks.get(key);

    if (!existing || existing.expiresAt <= now) {
      this.locks.set(key, { instanceId, expiresAt: now + ttlMs });
      return true;
    }

    if (existing.instanceId === instanceId) {
      existing.expiresAt = now + ttlMs;
      return true;
    }

    return false;
  }

  public release(key: string, instanceId: string): boolean {
    const existing = this.locks.get(key);
    if (existing && existing.instanceId === instanceId) {
      this.locks.delete(key);
      return true;
    }
    return false;
  }

  public getHolder(key: string): string | null {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) {
      return existing.instanceId;
    }
    return null;
  }

  public clear(): void {
    this.locks.clear();
  }
}

export class LeaderElection {
  public instanceId: string;
  public leaseDurationMs: number;
  public lockKey: string;
  private registry: SharedLockRegistry;
  private redis?: Redis;
  private _isLeader = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(options: LeaderElectionOptions, registry?: SharedLockRegistry) {
    this.instanceId = options.instanceId;
    this.leaseDurationMs = options.leaseDurationMs || 5000;
    this.lockKey = options.lockKey || 'marketpulse_worker_leader';
    this.registry = registry || SharedLockRegistry.getInstance();
    if (options.redisClient) {
      this.redis = options.redisClient;
    } else if (options.redisUrl) {
      try {
        this.redis = new Redis(options.redisUrl, { lazyConnect: true });
        this.redis.connect().catch(() => {});
      } catch {
        // Fallback to in-memory registry
      }
    }
  }

  public async acquire(): Promise<boolean> {
    if (this.redis) {
      try {
        const res = await this.redis.set(
          this.lockKey,
          this.instanceId,
          'PX',
          this.leaseDurationMs,
          'NX',
        );
        this._isLeader = res === 'OK';
        return this._isLeader;
      } catch {
        // Fallback
      }
    }
    const acquired = this.registry.tryAcquire(this.lockKey, this.instanceId, this.leaseDurationMs);
    this._isLeader = acquired;
    return acquired;
  }

  public async renew(): Promise<boolean> {
    if (!this._isLeader) return false;
    if (this.redis) {
      try {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("pexpire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
        const res = await this.redis.eval(
          script,
          1,
          this.lockKey,
          this.instanceId,
          this.leaseDurationMs,
        );
        this._isLeader = res === 1;
        return this._isLeader;
      } catch {
        // Fallback
      }
    }
    const renewed = this.registry.tryAcquire(this.lockKey, this.instanceId, this.leaseDurationMs);
    this._isLeader = renewed;
    return renewed;
  }

  public async release(): Promise<boolean> {
    if (this.redis) {
      try {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await this.redis.eval(script, 1, this.lockKey, this.instanceId);
      } catch {
        // Fallback
      }
    }
    const released = this.registry.release(this.lockKey, this.instanceId);
    this._isLeader = false;
    return released;
  }

  public isLeader(): boolean {
    return this._isLeader;
  }

  public startHeartbeat(intervalMs = 2000): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(async () => {
      if (this._isLeader) {
        await this.renew();
      } else {
        await this.acquire();
      }
    }, intervalMs);
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  public stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }
}
