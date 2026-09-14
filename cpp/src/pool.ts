import { RpcClient } from "./rpc.ts";
import type { Thread } from "./thread.ts";

export type ThreadFactory = () => Thread;

/**
 * Lazily creates named workers and reuses them for subsequent jobs.
 */
export class WorkerPool {
  private readonly clients = new Map<string, RpcClient>();
  private created = 0;

  get createCount(): number {
    return this.created;
  }

  acquire(name: string, factory: ThreadFactory): RpcClient {
    const existing = this.clients.get(name);
    if (existing) return existing;
    const client = new RpcClient(factory());
    this.created += 1;
    this.clients.set(name, client);
    return client;
  }

  has(name: string): boolean {
    return this.clients.has(name);
  }

  async close(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((client) => client.terminate()));
  }
}
