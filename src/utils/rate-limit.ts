// Simple in-memory rate limiter keyed by IP + bucket name.
// Per-server-instance — adequate for single-node dev/prod.
// For horizontal scaling, swap with Upstash/Redis.

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanup(now);

  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, limit, resetAt };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  return {
    allowed: existing.count <= limit,
    remaining,
    limit,
    resetAt: existing.resetAt,
  };
}

export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
