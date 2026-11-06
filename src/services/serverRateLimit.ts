import "server-only";

/**
 * Small in-memory limiter and TTL cache for the map-provider proxies. Good
 * enough for a single Node instance; production should use a shared store
 * (e.g. Redis/Upstash) — see README "Production readiness".
 */
const buckets = new Map<string, { start: number; count: number }>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 5000) buckets.clear();
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export class TtlCache<V> {
  private store = new Map<string, { at: number; value: V }>();
  constructor(
    private ttlMs: number,
    private max = 500,
  ) {}
  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V) {
    if (this.store.size >= this.max) this.store.delete(this.store.keys().next().value as string);
    this.store.set(key, { at: Date.now(), value });
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
