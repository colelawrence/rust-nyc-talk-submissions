/**
 * Admin Authentication Middleware
 *
 * Provides Bearer token authentication for admin/test endpoints.
 * Uses timing-safe token comparison to prevent timing attacks.
 */

import type { Context, Next } from "https://esm.sh/hono@3.11.7";

/**
 * Timing-safe string comparison helper.
 * Pads strings to equal length and compares byte-by-byte.
 * Always runs in constant time to prevent timing attacks.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Pad to equal length (prevents length leakage)
  const maxLen = Math.max(a.length, b.length);
  const aPadded = a.padEnd(maxLen, "\0");
  const bPadded = b.padEnd(maxLen, "\0");

  // Convert to byte arrays
  const aBytes = new TextEncoder().encode(aPadded);
  const bBytes = new TextEncoder().encode(bPadded);

  // XOR all bytes and accumulate (constant time)
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }

  return diff === 0;
}

/**
 * Log authentication failure with timestamp and client IP.
 * Never logs the actual token value for security.
 *
 * @param c - Hono context
 * @param reason - Reason for auth failure
 */
function logAuthFailure(c: Context, reason: string): void {
  const timestamp = new Date().toISOString();
  const clientIp = c.req.header("cf-connecting-ip") ?? "unknown";
  
  console.warn(
    `🔒 [Auth] ${reason} | time=${timestamp} | ip=${clientIp}`
  );
}

/**
 * Hono middleware that enforces ADMIN_TOKEN bearer authentication.
 *
 * Authorization flow:
 * 1. Check if ADMIN_TOKEN is configured (non-empty after trim)
 * 2. Extract bearer token from Authorization header
 * 3. Compare tokens using timing-safe comparison
 * 4. Log failures with timestamp and IP (never the token value)
 *
 * Response codes:
 * - 500: ADMIN_TOKEN not configured (server misconfiguration)
 * - 401: Invalid or missing authorization header
 *
 * @param c - Hono context
 * @param next - Next middleware in chain
 * @returns Response on auth failure, or continues to next middleware
 */
export async function requireAdmin(c: Context, next: Next) {
  const adminToken = Deno.env.get("ADMIN_TOKEN")?.trim();

  // 500 if ADMIN_TOKEN not configured
  if (!adminToken) {
    logAuthFailure(c, "ADMIN_TOKEN not configured");
    return c.json(
      { error: "ADMIN_TOKEN not configured" },
      500
    );
  }

  // Extract bearer token
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader) {
    logAuthFailure(c, "Missing Authorization header");
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Parse "Bearer <token>"
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  
  if (!match) {
    logAuthFailure(c, "Invalid Authorization header format");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const providedToken = match[1];

  // Timing-safe comparison
  if (!timingSafeEqual(providedToken, adminToken)) {
    logAuthFailure(c, "Invalid token");
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Auth success - continue to next middleware
  await next();
}
