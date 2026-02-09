import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";
import type { Context, Next } from "https://esm.sh/hono@3.11.7";

const TABLE_NAME = "rate_limit_store";

/** Rate limiter configuration */
export interface RateLimiterConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Maximum retry attempts for transaction conflicts */
  maxRetries?: number;
  /** Initial backoff delay in ms (doubles each retry) */
  initialBackoffMs?: number;
}

/** Rate limiter result */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Seconds until the next request is allowed (if not allowed) */
  retryAfterSeconds?: number;
}

/**
 * SQLite-backed rate limiter with sliding window
 * - Stores request timestamps as JSON array
 * - Uses BEGIN IMMEDIATE transactions with retry/backoff
 * - Fails open on persistent errors
 */
export class RateLimiter {
  private readonly config: Required<RateLimiterConfig>;
  private readonly windowMs: number;
  private initialized = false;

  constructor(config: RateLimiterConfig) {
    this.config = {
      maxRetries: 3,
      initialBackoffMs: 50,
      ...config,
    };
    // Convert windowSeconds to milliseconds internally
    this.windowMs = config.windowSeconds * 1000;
  }

  /** Initialize the rate limit storage table */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Set busy timeout to handle contention
      await sqlite.execute("PRAGMA busy_timeout = 5000");

      await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        key TEXT PRIMARY KEY,
        request_times TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      console.log(`✅ [RateLimit] Initialized table: ${TABLE_NAME}`);
      this.initialized = true;
    } catch (error) {
      console.error(`💥 [RateLimit] Failed to initialize table:`, error);
      throw error;
    }
  }

  /**
   * Check and record a request for rate limiting
   * @param key - Rate limit key (e.g., IP address)
   * @returns Rate limit result with allowed status and retry info
   */
  async check(key: string): Promise<RateLimitResult> {
    await this.init();

    const now = Date.now();
    const windowStart = now - this.windowMs;

    let attempt = 0;
    while (attempt <= this.config.maxRetries) {
      try {
        return await this.checkWithTransaction(key, now, windowStart);
      } catch (error) {
        const isBusy = this.isSqliteBusyError(error);

        if (isBusy && attempt < this.config.maxRetries) {
          const backoffMs = this.config.initialBackoffMs * Math.pow(2, attempt);
          console.warn(
            `⚠️ [RateLimit] SQLITE_BUSY for key=${key}, retry ${attempt + 1}/${this.config.maxRetries} after ${backoffMs}ms`,
          );
          await this.sleep(backoffMs);
          attempt++;
          continue;
        }

        // Fail open: allow request on persistent errors
        console.error(
          `💥 [RateLimit] Failed after ${attempt + 1} attempts for key=${key}, failing open:`,
          error,
        );
        return { allowed: true };
      }
    }

    // Should never reach here, but fail open just in case
    console.error(`💥 [RateLimit] Exhausted retries for key=${key}, failing open`);
    return { allowed: true };
  }

  /**
   * Execute rate limit check within a transaction
   */
  private async checkWithTransaction(
    key: string,
    now: number,
    windowStart: number,
  ): Promise<RateLimitResult> {
    try {
      // Start immediate transaction to acquire write lock
      await sqlite.execute("BEGIN IMMEDIATE");

      // Fetch current state
      const result = await sqlite.execute(
        `SELECT request_times FROM ${TABLE_NAME} WHERE key = ?`,
        [key],
      );

      let requestTimes: number[] = [];

      if (result.rows.length > 0) {
        const row = result.rows[0] as unknown as { request_times: string };
        const storedTimes = row.request_times;
        try {
          const parsed = JSON.parse(storedTimes);
          if (Array.isArray(parsed)) {
            requestTimes = parsed;
          } else {
            console.warn(
              `⚠️ [RateLimit] Invalid stored times for key=${key}, resetting`,
            );
          }
        } catch (jsonError) {
          console.warn(
            `⚠️ [RateLimit] Corrupt JSON for key=${key}, resetting:`,
            jsonError,
          );
          // Fail open: reset to empty array
          requestTimes = [];
        }
      }

      // Filter to sliding window
      const recentRequests = requestTimes.filter((t) => t >= windowStart);

      // Check rate limit
      if (recentRequests.length >= this.config.maxRequests) {
        // Calculate retry-after
        const oldestInWindow = Math.min(...recentRequests);
        const retryAfterMs = oldestInWindow + this.windowMs - now;
        const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

        // Update updated_at even on denial
        if (result.rows.length > 0) {
          await sqlite.execute(
            `UPDATE ${TABLE_NAME} SET updated_at = ? WHERE key = ?`,
            [now, key],
          );
        }

        await sqlite.execute("COMMIT");

        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, retryAfterSeconds),
        };
      }

      // Allow request: add current timestamp
      const updatedTimes = [...recentRequests, now];
      const updatedJson = JSON.stringify(updatedTimes);

      if (result.rows.length > 0) {
        await sqlite.execute(
          `UPDATE ${TABLE_NAME} SET request_times = ?, updated_at = ? WHERE key = ?`,
          [updatedJson, now, key],
        );
      } else {
        await sqlite.execute(
          `INSERT INTO ${TABLE_NAME} (key, request_times, updated_at) VALUES (?, ?, ?)`,
          [key, updatedJson, now],
        );
      }

      await sqlite.execute("COMMIT");

      return { allowed: true };
    } catch (error) {
      // Rollback on any error
      try {
        await sqlite.execute("ROLLBACK");
      } catch (rollbackError) {
        console.error(`💥 [RateLimit] Rollback failed:`, rollbackError);
      }
      throw error;
    }
  }

  /**
   * Detect SQLITE_BUSY error via message matching
   */
  private isSqliteBusyError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes("sqlite_busy") || message.includes("database is locked");
    }
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Extract rate limit key from request headers
 * - Uses CF-Connecting-IP header (Cloudflare)
 * - Falls back to "unknown"
 */
function extractRateLimitKey(c: Context): string {
  const cfIp = c.req.header("cf-connecting-ip");
  return cfIp || "unknown";
}

/**
 * Create Hono middleware for rate limiting
 * @param limiter - Configured RateLimiter instance
 * @returns Hono middleware function
 */
export function rateLimitMiddleware(limiter: RateLimiter) {
  return async (c: Context, next: Next) => {
    const key = extractRateLimitKey(c);
    const result = await limiter.check(key);

    if (!result.allowed) {
      return c.json(
        { error: "Rate limit exceeded" },
        429,
        {
          "Retry-After": String(result.retryAfterSeconds),
        },
      );
    }

    await next();
  };
}
