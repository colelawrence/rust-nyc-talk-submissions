# Platform hardening: submissions + Discord + admin safety

> This plan is **execution-frozen** (beaded). Capture learnings/progress in `br comments add <bead-id> ...` instead of editing this doc (except status/bead mapping).

Plan status: **beaded** (execution-frozen)
Epic bead: `talk-19w`
Beadified at: 2026-02-09

## Bead Mapping

| Gate | Beads |
| --- | --- |
| Invite expiration defaults (configurable) | `talk-19w.1` |
| Protect admin/test endpoints with ADMIN_TOKEN | `talk-19w.2` |
| Submission rate limiting (abuse control) | `talk-19w.3` |
| DB indexes + optional retention | `talk-19w.4`, `talk-19w.5` |
| API response shaping + docs polish | `talk-19w.6`, `talk-19w.7` |

## Goal & Motivation
Reduce production risk and abuse surface for the talk-submission system by:
- making Discord invite links expire by default (configurable)
- protecting admin/debug endpoints behind authentication
- adding lightweight submission abuse controls (rate limiting)
- improving data hygiene for long-running deployments (indexes + optional retention)

## Scope
### In-scope
- Discord invite expiration defaults + env override
- Admin auth middleware reuse (ADMIN_TOKEN)
- Protecting existing "admin-ish" endpoints (`GET /api/submissions`, `POST /api/discord/test`)
- Basic rate limiting for `POST /api/submissions`
- DB indexes for hot queries + optional retention for non-critical logs (autothread + rate-limit logs)
- README updates for new env vars and auth requirements

### Out-of-scope
- TalkTriage feature work (tracked in `.context/plans/talktriage.md`)
- Any Discord Gateway/WebSocket features
- Building a full admin UI

## Codebase context
| Area | Files / identifiers |
| --- | --- |
| Submission API | `backend/index.ts` (`POST /api/submissions`, `GET /api/submissions`) |
| Config | `backend/config.ts` (`RuntimeConfig`, `DiscordConfig`, `loadEnv()`) |
| Discord REST wrapper | `backend/discord.ts` (`RealDiscordService.createInvite`, `.sendMessage`) |
| Message formatting | `backend/messages.ts` (`sanitizeChannelName`, `talkContextMessages`) |
| Existing admin auth pattern | `backend/autothread-debug.http.ts` (`requireAdmin()` middleware) |
| Autothread DB access | `backend/autothread/store.ts` (`isChannelOnCooldown`, tables) |
| Public docs | `README.md` (env vars + endpoints) |

**Architecture notes (security-relevant):**
- Val Town runs serverless Deno; multiple concurrent requests may hit the same SQLite database. Rate limiting and retention deletions must handle this gracefully (parameterized queries, transactions, fail-open on lock contention).
- Admin endpoints use bearer token auth. Val Town provides HTTPS by default; ensure ADMIN_TOKEN is never transmitted over unencrypted channels.
- **SQLite import location:** Use `import { sqlite } from "https://esm.town/v/stevekrouse/sqlite"` for all SQLite operations (matches existing codebase pattern from backend/autothread/store.ts).

**Layering & module boundaries (this plan adds):**
- **Auth layer:** Extract `backend/auth.ts` from autothread-debug.http.ts - exports `requireAdmin(): HonoMiddleware` for reuse across endpoints. Reads `ADMIN_TOKEN` directly from env (exception to config-first pattern; justified by independence from business config). No dependencies on business logic.
- **Rate limiting layer:** Add `backend/rate-limit.ts` - exports `RateLimiter` class with SQLite-backed store. Depends only on sqlite. Constructed in backend/index.ts with values from RuntimeConfig.
- **Config contract:** `DiscordConfig.inviteMaxAge: number`, `RuntimeConfig.rateLimitWindowSeconds/rateLimitMax/rateLimitEnabled`, `RuntimeConfig.autothreadLogRetentionDays/rateLimitRetentionDays` (all validated at load time in `loadEnv()`). 
  - **Validation location:** All validation logic lives in `backend/config.ts` within `loadEnv()` function.
  - **Validation behavior:** Parse env vars, check ranges/types, throw descriptive Error if invalid. Errors will crash the Val on startup (fail-fast pattern).
- **Dependency direction:** config → services (discord, rate-limit) → endpoints. Cron vals import config independently. No circular dependencies.
- **Initialization order (backend/index.ts):** 
  1. Load config via `loadEnv()` (fails fast on validation errors)
  2. Construct services (RealDiscordService, RateLimiter) with config values
  3. Register routes with inline middleware:
     - Auth middleware applied per-route (e.g., `app.get('/api/submissions', requireAdmin(), handler)`)
     - Rate limit middleware applied conditionally per-route based on config flag
  4. No global/app-level middleware in this plan (all per-route)

## Execution workflow (skills)
- Use `/skill:plan-continue` to execute gate-by-gate.
- Use `/skill:atomic-commit` for safe, atomic commits per gate.
- Use `/skill:agent-review` before pushing each gate (esp. auth + rate limiting).
- Use `/skill:delivery-notes` after finishing to summarize changes + verification.

---

## Gate: Invite expiration defaults (configurable)

### Deliverables
- Add env var `DISCORD_INVITE_MAX_AGE_SECONDS`.
  - Default: `604800` (7 days; Discord max for `max_age`).
  - Allow override to `0` (never expires) or any integer `1..604800`.
  - If invalid/out of range: throw startup error from `loadEnv()` with message specifying valid range.
- **Contract change in `backend/config.ts`:**
  - Add `DiscordConfig.inviteMaxAge: number` (validated in `loadEnv()`, range-checked, parsed as integer).
  - Validation logic in `loadEnv()` ensures value is `0` or `1..604800` before returning config object.
- **Interface change in `backend/discord.ts`:**
  - `RealDiscordService` constructor accepts `config: DiscordConfig`.
  - `createInvite()` reads `this.config.inviteMaxAge` and passes to Discord API `max_age` parameter.
- **Wiring in `backend/index.ts`:**
  - After `loadEnv()`, pass DiscordConfig to RealDiscordService constructor:
    ```ts
    const config = loadEnv()
    const discordService = new RealDiscordService(config.discord)
    ```
- Update README to document `DISCORD_INVITE_MAX_AGE_SECONDS` env var + Discord's `max_age` limits (0 or 1..604800 range). (Final comprehensive README update happens in last gate; this is a minimal addition.)

### Acceptance criteria
- With env var unset, created invites show "expires in 7 days" in Discord UI.
- With env var set to `0`, invites do not expire (matches previous behavior).
- With env var set to e.g. `3600`, invites expire in ~1 hour.

### Verification
- Manual: create a test channel via `POST /api/discord/test` and view the invite details in Discord.
- (Optional) Add a one-off debug log in `createInvite` showing the chosen `max_age`.
  - **Security note:** Do NOT log the invite code/URL itself (it grants bearer access to join the Discord server; treat it like a password). Log only the `max_age` parameter.

### Error handling requirements
- If Discord API call fails (network, rate limit, permissions): `createInvite()` must throw with actionable error message. Caller (`POST /api/submissions`) already has try/catch that returns 500.
- If validation fails at startup (invalid `DISCORD_INVITE_MAX_AGE_SECONDS`): throw immediately from `loadEnv()` with message specifying valid range and current value.

---

## Gate: Protect admin/test endpoints with ADMIN_TOKEN

### Deliverables
- **Create `backend/auth.ts`:** Extract and generalize `requireAdmin()` from `backend/autothread-debug.http.ts`.
  - Export signature: `requireAdmin(): HonoMiddleware` (returns Hono middleware, no parameters).
  - Reads `ADMIN_TOKEN` from `Deno.env.get()` directly (exception to config-first pattern; justified by keeping auth layer independent of business config).
  - **Token validation:** Trim whitespace from token and reject if empty after trimming.
  - **Error response contract (JSON):**
    - 500 if `ADMIN_TOKEN` missing, empty string, or only whitespace: `{ error: "ADMIN_TOKEN not configured" }`
    - 401 if header missing/wrong: `{ error: "Unauthorized" }`
  - **Security requirement:** Use timing-safe comparison (Deno does not provide a built-in `timingSafeEqual`).
    - Implement a small local helper in `backend/auth.ts` (no exports needed):
      ```ts
      function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
        const len = Math.max(a.length, b.length)
        let diff = a.length ^ b.length
        for (let i = 0; i < len; i++) {
          const ai = i < a.length ? a[i] : 0
          const bi = i < b.length ? b[i] : 0
          diff |= ai ^ bi
        }
        return diff === 0
      }
      ```
    - Convert both expected and provided tokens to bytes with `TextEncoder`.
    - Pad both strings to the same length before encoding to avoid length-based timing differences:
      ```ts
      const maxLen = Math.max(expected.length, provided.length)
      const expectedBytes = new TextEncoder().encode(expected.padEnd(maxLen, "\0"))
      const providedBytes = new TextEncoder().encode(provided.padEnd(maxLen, "\0"))
      const equal = timingSafeEqual(expectedBytes, providedBytes)
      ```
  - **Operability requirement:** Log authentication failures (timestamp + source IP from `cf-connecting-ip` header) to console for security monitoring. Do NOT log the provided token value.
- **Apply middleware in `backend/index.ts`:**
  - `app.get('/api/submissions', requireAdmin(), async (c) => { ... })`
  - `app.post('/api/discord/test', requireAdmin(), async (c) => { ... })`
    - **Handler implementation order:** (1) `requireAdmin()` middleware runs first (401/500 if unauthorized), (2) then handler checks `ENABLE_TEST_API` env var (404 if false), (3) then executes test logic.
    - **Rationale:** Auth check must precede feature flag check to prevent info leakage.
- Update README with ADMIN_TOKEN requirements (minimum 32 chars, recommend `openssl rand -hex 32`) and endpoint auth requirements. (Final comprehensive README update happens in last gate; this is a minimal addition.)

### Acceptance criteria
- `GET /api/submissions` no longer leaks data publicly.
- `POST /api/discord/test` can't be used by anonymous users to spam Discord.

### Verification
- `curl` without header returns 401/500 (depending on whether ADMIN_TOKEN is set).
- `curl -H "Authorization: Bearer $ADMIN_TOKEN" ...` works.
- **Security test:** Code inspection of `backend/auth.ts` - confirm a timing-safe compare helper is used (not `===` or `==`) and that values are padded to equal length before comparing.

---

## Gate: Submission rate limiting (abuse control)

### Deliverables
- **Create `backend/rate-limit.ts`:** New module exporting `RateLimiter` class and Hono middleware factory.
  - **Interface:**
    ```ts
    class RateLimiter {
      constructor(config: { windowSeconds: number; maxRequests: number })
      async checkLimit(key: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>
      // retryAfterSeconds: present when allowed=false, indicates seconds until oldest request expires
      //                    absent when allowed=true
    }
    export function rateLimitMiddleware(limiter: RateLimiter): HonoMiddleware
    ```
  - **SQLite schema (created in constructor):**
    ```sql
    CREATE TABLE IF NOT EXISTS rate_limit_store (
      key TEXT PRIMARY KEY,
      request_times TEXT NOT NULL,  -- JSON array of epoch_ms integers
      updated_at INTEGER NOT NULL   -- epoch_ms of last update (for retention cleanup)
    )
    ```
  - RateLimiter.checkLimit() updates `updated_at` on every check (both allowed and denied).
  - **Middleware contract (rateLimitMiddleware implementation):**
    - Extracts rate limit key from request: best-effort client IP via `c.req.header('cf-connecting-ip')` (Val Town's trusted header; do NOT use `x-forwarded-for` or `x-real-ip` as they can be spoofed). Fallback to `"unknown"` if missing.
    - Calls `limiter.checkLimit(key)`.
    - If `allowed: false`, return 429 response with JSON `{ error: "Rate limit exceeded" }` and `Retry-After` header (integer seconds, rounded up).
    - If `allowed: true`, call `await next()` to continue request processing.
  - **Security requirements:**
    - Use parameterized queries for all rate limiter DB operations (IP address goes in a parameter, never string interpolation).
    - Accept that concurrent requests may race; SQLite will serialize writes. If a lock timeout occurs, fail open (allow the request) rather than fail closed.
  - **Algorithm (RateLimiter.checkLimit implementation):** Sliding window - on each check, delete expired timestamps (older than windowSeconds), count remaining, update store.
  - **Concurrency safety requirements:**
    - All rate limit operations (read-filter-write) must occur within a single SQLite transaction using `BEGIN IMMEDIATE` to acquire write lock upfront.
    - If transaction fails with `SQLITE_BUSY` (database locked), retry up to 3 times with exponential backoff (10ms, 50ms, 250ms).
    - After 3 retries, fail open (return `{ allowed: true }`) and log warning: `[rate-limit] Database lock timeout for key=${key}, allowing request`.
    - JSON array parsing: if `request_times` column is corrupt/unparseable, treat as empty array (fail open), log warning: `[rate-limit] Corrupt data for key=${key}, resetting`, and overwrite with fresh data on next update.
  - **Performance requirement:** Set SQLite busy timeout to 5000ms globally in rate-limit.ts module initialization (`PRAGMA busy_timeout = 5000`).
  - **Operability requirement:** Log rate limit denials (timestamp, IP, retry-after) at INFO level for monitoring abuse patterns. Aggregate stats (requests allowed/denied per minute) optional but recommended.
- **Wire into `backend/index.ts`:**
  - After `loadEnv()`, instantiate `RateLimiter` with config values:
    ```ts
    const config = loadEnv()
    const limiter = new RateLimiter({
      windowSeconds: config.rateLimitWindowSeconds,
      maxRequests: config.rateLimitMax
    })
    ```
  - Apply middleware conditionally based on config: 
    ```ts
    // Extract handler function to avoid duplication
    const submissionHandler = async (c: Context) => { /* existing handler logic */ }
    
    if (config.rateLimitEnabled) {
      app.post('/api/submissions', rateLimitMiddleware(limiter), submissionHandler)
    } else {
      app.post('/api/submissions', submissionHandler)
    }
    ```
    - **Rationale:** Avoid duplicating handler logic in if/else branches.
- **Config in `backend/config.ts` (add to `RuntimeConfig`):**
  - `rateLimitWindowSeconds: number` default `900`
  - `rateLimitMax: number` default `10`
  - `rateLimitEnabled: boolean` default `true`
- **Response contract on limit:**
  - HTTP 429
  - JSON `{ error: "Rate limit exceeded" }`
  - `Retry-After` header (seconds until oldest request in window expires)

### Acceptance criteria
- Normal submitters are unaffected.
- Burst spam is throttled.
- If IP can't be determined, "unknown" bucket still prevents global abuse.

### Verification
- Use a looped `curl` to exceed limits and confirm 429 + Retry-After.

---

## Gate: DB indexes + optional retention

### Deliverables
- **Add indexes (in respective module table creation code):**
  - Autothread cooldown query (`backend/autothread/store.ts`): composite index on processed table `(channel_id, status, processed_at)` (in that order; matches WHERE clause).
  - Submissions list (admin, `backend/index.ts`): single-column index on `${TABLE_NAME}(created_at)` for ORDER BY.
  - Rate limit table (`backend/rate-limit.ts`): ensure PRIMARY KEY on `key` column for fast lookups (already specified in schema).
- **Optional retention (new module `backend/retention.cron.ts`):**
  - **Interface:** Standalone cron val, no exports. Runs independently, does not block API requests.
  - **Schedule:** Daily (e.g., `@daily` or specific time like `0 2 * * *` for 2am UTC).
  - **Config access:** Import and call `loadEnv()` from `backend/config.ts` at cron start. If config validation fails, log error and exit cron run (do not retry - wait for next scheduled run). This prevents cascading failures from config errors.
  - **Config (add to `backend/config.ts`):**
    - `autothreadLogRetentionDays: number` default `30` (set `0` to disable)
    - `rateLimitRetentionDays: number` default `30` (set `0` to disable)
  - **Table allow-list (hardcoded in retention.cron.ts):**
    ```ts
    import { loadEnv } from './config.ts'
    const config = loadEnv()
    const RETENTION_TABLES = [
      { name: 'autothread_processed', retentionDays: config.autothreadLogRetentionDays, timestampColumn: 'processed_at' },
      { name: 'rate_limit_store', retentionDays: config.rateLimitRetentionDays, timestampColumn: 'updated_at' }
    ]
    // NEVER include talk_submissions_* in this list
    ```
  - **Safety requirements:**
    - Use parameterized queries for deletes.
    - **Batch delete algorithm (per table):**
      1. Calculate cutoff: `Date.now() - (retentionDays * 86400 * 1000)`
      2. Assert cutoff < Date.now() (guard against config errors)
      3. Assert table name in RETENTION_TABLES allow-list
      4. Loop (max 10,000 iterations):
         - `BEGIN IMMEDIATE`
         - `DELETE FROM ${table} WHERE ${timestampColumn} < ? LIMIT 100` (parameterized)
         - `COMMIT`
         - If deleted count = 0, exit loop
         - Accumulate total deleted count
      5. Log total: `[retention] Deleted {totalCount} rows from {table} older than {cutoffDate.toISOString()}`
      6. If loop hits max iterations, log error: `[retention] Max iterations reached for {table}, aborted` and continue to next table
    - **Guard rail:** Before delete loop, assert table name is in RETENTION_TABLES allow-list. If not, throw error and abort cron run.
    - **Guard rail:** After calculating cutoff timestamp, assert it's in the past (< Date.now()). If not, throw error - indicates clock skew or config error.
  - **Concurrency safety:** Set SQLite busy timeout (`PRAGMA busy_timeout = 30000`) at cron start to handle contention with API writes. If delete transaction fails with lock error after timeout, log warning and skip that table (do not fail entire cron run).
  - **Cron overlap handling:** If cron is still running when next execution triggers (e.g., deletes take >24h), Val Town will queue or skip the new execution (platform behavior). Implementation does not need explicit distributed locking - SQLite transactions provide sufficient safety.

### Acceptance criteria
- No functional changes to Talk Submission history.
- Autothread cooldown queries stay fast over time.
- Retention (if enabled) does not delete talk submissions.

### Verification
- Inspect SQLite schema for new indexes.
- If retention enabled, validate counts drop only for log tables after simulated old rows.

---

## Gate: API response shaping + docs polish

### Deliverables
- **Response contract for `GET /api/submissions` (in backend/index.ts):**
  - **Query params:** `?limit=50&offset=0` (defaults if omitted; parse as integers).
    - **Validation requirements:**
      - `limit`: must be integer between 1 and 1000 (inclusive). If out of range, return 400 with `{ error: "limit must be between 1 and 1000" }`.
      - `offset`: must be non-negative integer. If negative or non-integer, return 400 with `{ error: "offset must be non-negative integer" }`.
      - Parse using `parseInt(value, 10)` and validate result is not NaN.
  - **Response schema (JSON):**
    ```ts
    {
      data: Array<TalkSubmission>,  // full row data (includes PII: email, discord_handle, linkedin_url)
      total: number,                 // total count before pagination
      limit: number,
      offset: number
    }
    ```
  - Implementation: Execute two queries: `SELECT COUNT(*) ...` for total, then `SELECT * ... LIMIT ? OFFSET ?` for data.
  - Convert sqlite `Row` objects to plain objects before returning: `rows.map((r) => ({ ...r }))`.
  - **PII note in README:** Document that `GET /api/submissions` returns full PII (requires ADMIN_TOKEN; do not expose to end users).
  - **Performance decision:** Use exact COUNT(*) for MVP. If count query exceeds 100ms in production (>10k submissions), file a follow-up bead to optimize (cached count or omit total for large offsets).
- **Type safety (add to `shared/types.ts`):**
  - Export `TalkSubmission` interface matching SQLite schema.
  - Export `SubmissionsResponse` interface matching the response schema above.
- **Comprehensive README update (consolidate all plan changes):**
  - **Environment Variables section:**
    - `DISCORD_INVITE_MAX_AGE_SECONDS` (default 604800, range: 0 or 1..604800)
    - `ADMIN_TOKEN` (required for admin endpoints, minimum 32 chars, recommend `openssl rand -hex 32`)
    - `RATE_LIMIT_ENABLED` (default true)
    - `RATE_LIMIT_WINDOW_SECONDS` (default 900)
    - `RATE_LIMIT_MAX` (default 10)
    - `AUTOTHREAD_LOG_RETENTION_DAYS` (default 30, set 0 to disable)
    - `RATE_LIMIT_RETENTION_DAYS` (default 30, set 0 to disable)
  - **Endpoints section:**
    - `GET /api/submissions` requires `Authorization: Bearer $ADMIN_TOKEN` header, supports `?limit=N&offset=M` params (limit 1-1000, offset >=0), returns `{ data, total, limit, offset }` with full PII.
    - `POST /api/discord/test` requires `Authorization: Bearer $ADMIN_TOKEN` header and `ENABLE_TEST_API=true`.
    - `POST /api/submissions` enforces rate limiting if enabled (429 + Retry-After on limit).
  - **Discord invite behavior:** Default 7-day expiry (configurable via `DISCORD_INVITE_MAX_AGE_SECONDS`).
  - **De-duplicate:** Remove any partial updates from earlier gates that are now covered here.

### Acceptance criteria
- Admin endpoints are predictable and safe for tooling.
- README matches actual runtime behavior.

### Verification
- `GET /api/submissions?limit=10` returns a small array and is usable in JSON tooling.

