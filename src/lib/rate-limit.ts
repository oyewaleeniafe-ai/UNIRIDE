/**
 * In-memory sliding window rate limiter.
 *
 * For production, replace with Redis-backed limiter (e.g., @upstash/ratelimit).
 * This in-memory version resets on server restart and doesn't share state across
 * multiple server instances — fine for a single-server deployment.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  /** Unique identifier for this limit (e.g., "login", "register", "booking") */
  key: string;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given identifier.
 * Returns whether the request is allowed and metadata.
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const fullKey = `${config.key}:${identifier}`;
  const entry = store.get(fullKey);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(fullKey, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + windowMs,
    };
  }

  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Get the client IP from request headers or fallback.
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

// ─── Preset Configs ──────────────────────────────────

export const RATE_LIMITS = {
  login: {
    key: 'login',
    maxRequests: 5,
    windowSeconds: 60, // 5 attempts per minute
  },
  register: {
    key: 'register',
    maxRequests: 3,
    windowSeconds: 300, // 3 per 5 minutes
  },
  booking: {
    key: 'booking',
    maxRequests: 10,
    windowSeconds: 300, // 10 per 5 minutes
  },
  sos: {
    key: 'sos',
    maxRequests: 3,
    windowSeconds: 600, // 3 per 10 minutes
  },
  rating: {
    key: 'rating',
    maxRequests: 20,
    windowSeconds: 300, // 20 per 5 minutes
  },
  api: {
    key: 'api',
    maxRequests: 60,
    windowSeconds: 60, // 60 per minute
  },
} as const;
