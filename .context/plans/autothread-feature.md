# Auto-Threading Feature Plan

> **Interesting artifacts and learnings must be written back to this document.**

## Overview

Automatically create Discord threads on messages in channels with `[autothread]` in their topic/description. Uses high-frequency polling (every 2-5 seconds) since Val Town cannot use Discord WebSockets. Thread creation is **immediate** upon detecting new messages. AI uses recent message history (last ~4 messages or 5 minutes) purely for contextual thread naming.

**Key constraints:**
- Val Town environment (Deno, SQLite, cron triggers)
- No WebSocket support → high-frequency polling via `vt` cron (2-5 second interval)
- `valtown-watch` handles auto-sync
- Use `vt tail` for log observation during development

**Timing model:**
- Val Town cron triggers every 1 minute (minimum allowed)
- **Internal polling loop** runs every 2-5 seconds within each cron execution (~55 seconds of polling per run)
- New messages are threaded **immediately** upon detection
- Recent message context (last ~4 messages or 5 minutes) gathered only for AI summarization
- No intentional delay before threading

**Idempotency is critical** because:
- Multiple poll iterations occur within a single cron run
- Cron runs may overlap if execution takes longer than expected
- Same message may be seen across multiple poll iterations
- DB-based deduplication with optimistic insert is the primary safeguard

---

## Gate 0: Discord API Extension ✅

### Objectives
Extend the existing `DiscordService` with new endpoints required for auto-threading.

### Scope
- Add Discord API methods to `backend/discord.ts`
- Add 429 rate limit handling with retry logic

### Dependencies
- Existing `backend/discord.ts` infrastructure

### Task List

| Task | Acceptance Criteria |
|------|---------------------|
| Add `listGuildChannels()` method | Returns array of `{id, name, type, topic?}` from `GET /guilds/{guild_id}/channels` |
| Add `getMessages(channelId, options?)` method | Returns messages from `GET /channels/{channel_id}/messages` with `{after?: string, limit?: number}` options, limit clamped to 1-100 |
| Add `startThreadFromMessage(channelId, messageId, name)` method | Creates thread via `POST /channels/{channel_id}/messages/{message_id}/threads` |
| Add 429 rate limit handling in `request()` | On 429 response: parse `retry_after`, wait, retry (max 2 retries) |
| Add TypeScript types for Discord message/channel objects | Types match Discord API v10 response shapes |

### Verification

**Test scenarios:**
1. `listGuildChannels()` returns channels with correct shape including `topic` field
2. `getMessages()` respects `after` snowflake parameter and `limit`
3. `startThreadFromMessage()` creates thread and returns thread ID
4. Rate limit handling: mock 429 response triggers retry after delay
5. NoopDiscordService implements all new methods with appropriate logging

**Pass/fail criteria:**
- All methods return expected types
- Rate limit retry logic executes correctly (verified via logs in test environment)
- NoopDiscordService mirrors RealDiscordService interface

**Test organization:**
- Unit tests: `backend/__tests__/discord.test.ts`
- Integration tests (manual via `vt tail`): `backend/__tests__/discord.integration.ts`

---

## Gate 1: Database Schema + Dry-Run Cron ✅

### Objectives
Create tracking tables and a dry-run cron job that identifies candidate messages without creating threads.

### Scope
- New SQLite tables for channel tracking and message deduplication
- New cron file `backend/autothread.cron.ts`
- Environment variables for configuration

### Dependencies
- Gate 0 complete

### Task List

| Task | Acceptance Criteria |
|------|---------------------|
| Create `autothread_channels` table | Stores `channel_id`, `topic`, `last_seen_at`, `last_message_id` |
| Create `autothread_processed` table | Stores `channel_id`, `message_id`, `thread_id`, `status`, `error`, `processed_at` with PK on `(channel_id, message_id)` |
| Create `autothread.cron.ts` entry point | Exports default async function; runs internal loop polling every ~5 seconds for ~55 seconds |
| Implement channel discovery logic | Fetches guild channels, filters by `[autothread]` in topic |
| Implement message scanning logic | Fetches last ~20 messages, identifies any not yet processed |
| Track last-processed message per channel | Store `last_message_id` in `autothread_channels` for efficient polling |
| Implement dry-run logging | Logs "would create thread" for each candidate, inserts `status='dry_run'` |
| Add `AUTOTHREAD_DRY_RUN` env var | When `true`, skips actual thread creation |
| Add `AUTOTHREAD_CHANNEL_ALLOWLIST` env var | Comma-separated channel IDs; only process listed channels when set |
| Add per-run caps | `MAX_CHANNELS_PER_RUN=3`, `MAX_THREADS_PER_RUN=5` |

### Verification

**Test scenarios:**
1. Channel discovery correctly filters by `[autothread]` in topic (case-insensitive)
2. Channel allowlist restricts processing to listed channels only
3. New messages (not in `autothread_processed`) are identified immediately
4. Already-processed messages (existing in `autothread_processed`) are skipped
5. `last_message_id` tracking enables efficient incremental polling
6. Per-run caps prevent runaway processing
7. Dry-run mode logs candidates but does not call `startThreadFromMessage`
8. **Idempotency**: Same message seen in consecutive poll iterations is not reprocessed
9. Internal polling loop runs ~11 iterations (55s / 5s) per cron invocation

**Pass/fail criteria:**
- Cron runs without error (verified via `vt tail`)
- Correct messages identified in logs
- Database rows created with `status='dry_run'`
- No actual threads created when `AUTOTHREAD_DRY_RUN=true`

**Test organization:**
- Unit tests: `backend/__tests__/autothread.test.ts` (snowflake math, filtering logic)
- Integration tests: `backend/__tests__/autothread.integration.ts` (end-to-end dry run)
- Manual verification: `vt tail` during live dry-run

---

## Gate 2: Thread Creation (No AI) ✅

### Objectives
Actually create threads on identified messages using deterministic naming.

### Scope
- Implement thread creation logic
- Deterministic thread naming from message content
- Idempotent processing via optimistic DB insert

### Dependencies
- Gate 1 complete

### Task List

| Task | Acceptance Criteria |
|------|---------------------|
| Implement deterministic thread naming | First 60 chars of message content, sanitized; fallback to `Discussion from {author} @ {HH:MM}` |
| Implement optimistic insert pattern | Insert `status='processing'` before API call; skip on PK conflict (critical for idempotency across poll iterations and overlapping cron runs) |
| Call `startThreadFromMessage()` | Creates thread with deterministic name |
| Update database on success | Set `status='created'`, store `thread_id` |
| Update database on failure | Set `status='error'`, store error message |
| Ignore bot messages | Skip messages where `author.bot === true` |
| Ignore very short messages | Skip messages with content < 10 characters |

### Verification

**Test scenarios:**
1. Thread created with correct name (first 60 chars of message)
2. Fallback naming used when message content is unsuitable
3. Bot messages are skipped
4. Short messages (< 10 chars) are skipped
5. PK conflict in DB correctly prevents duplicate thread creation
6. API error results in `status='error'` row, not crash
7. Rate limits handled gracefully with retry

**Pass/fail criteria:**
- Threads appear in Discord with expected names
- Database accurately reflects thread creation status
- No duplicate threads created for same message
- Errors logged and captured in DB, cron continues

**Test organization:**
- Unit tests: `backend/__tests__/autothread.test.ts` (naming logic, filtering)
- Integration tests: Run cron on test channel, verify threads created
- Manual verification: Check Discord test channel

---

## Gate 3: AI-Powered Thread Naming ✅

### Objectives
Use OpenAI to generate contextual thread names and summaries from recent messages.

### Scope
- Gather message context (5 before, 2 after target message)
- Call OpenAI for thread name + summary
- Post summary as first message in created thread
- Graceful fallback to deterministic naming on AI failure

### Dependencies
- Gate 2 complete
- `OPENAI_API_KEY` environment variable

### Task List

| Task | Acceptance Criteria |
|------|---------------------|
| Add `AUTOTHREAD_ENABLE_AI` env var | When `false` or unset, use deterministic naming |
| Implement context gathering | Collect last ~4 messages before target (or up to 5 min of history) for context |
| Create AI prompt for thread naming | Returns `thread_name` (≤100 chars) and `summary` (2-5 bullets) |
| Call OpenAI API | Use `gpt-4o-mini`, limit tokens appropriately |
| Create thread with AI name | Use AI-generated name, fallback to deterministic on failure |
| Post summary in thread | Send AI summary as first message in new thread |
| Implement token/cost limits | Limit context to ~1000 tokens input |
| Fallback on AI error | Log error, proceed with deterministic name, skip summary |

### Verification

**Test scenarios:**
1. AI generates appropriate thread name from context
2. Thread name respects 100 character Discord limit
3. Summary is posted as first message in thread
4. AI failure results in fallback to deterministic name (not crash)
5. Context gathering correctly selects nearby messages
6. `AUTOTHREAD_ENABLE_AI=false` skips AI entirely

**Pass/fail criteria:**
- AI-named threads are contextually relevant
- Summary provides useful context for thread participants
- No failures when AI is unavailable/errors
- Token usage stays within limits

**Test organization:**
- Unit tests: `backend/__tests__/autothread-ai.test.ts` (context gathering, prompt construction)
- Integration tests: Run cron with AI enabled on test channel
- Manual verification: Review AI-generated names and summaries in Discord

---

## Gate 4: Operational Hardening ✅

### Objectives
Production-ready safeguards and operational improvements.

### Scope
- Per-channel cooldowns
- Ignore rules for commands and special messages
- Monitoring and alerting
- Documentation

### Dependencies
- Gate 3 complete

### Task List

| Task | Acceptance Criteria |
|------|---------------------|
| Add per-channel cooldown | No more than 3 threads created per channel per 10 minutes |
| Add command prefix ignore list | Skip messages starting with `!`, `/`, `.` |
| Add content filter | Skip messages that are only emoji, links, or mentions |
| Add `autothread_stats` table | Track threads created per channel per day for monitoring |
| Implement health check endpoint | `/api/autothread/health` returns last run status, errors |
| Add README documentation | Document env vars, behavior, and operational considerations |
| Add channel-specific config | `[autothread:quiet]` disables AI summary posting |

### Verification

**Test scenarios:**
1. Per-channel cooldown prevents burst thread creation
2. Command messages (starting with `!`, `/`, `.`) are skipped
3. Emoji-only and link-only messages are skipped
4. Stats table accurately tracks daily thread counts
5. Health endpoint returns meaningful status
6. `[autothread:quiet]` mode creates threads without summary messages

**Pass/fail criteria:**
- System operates safely under burst message conditions
- Operational visibility via health endpoint
- Documentation is accurate and complete

**Test organization:**
- Unit tests: `backend/__tests__/autothread-hardening.test.ts`
- Load tests: Simulate burst of messages, verify caps/cooldowns
- Manual verification: Review stats and health endpoint

---

## Environment Variables Summary

| Variable | Gate | Required | Description |
|----------|------|----------|-------------|
| `DISCORD_BOT_TOKEN` | 0 | Yes | Bot authentication |
| `DISCORD_GUILD_ID` | 0 | Yes | Guild to monitor |
| `AUTOTHREAD_DRY_RUN` | 1 | No | Skip actual thread creation when `true` |
| `AUTOTHREAD_CHANNEL_ALLOWLIST` | 1 | No | Comma-separated channel IDs |
| `AUTOTHREAD_ENABLE_AI` | 3 | No | Enable AI naming when `true` |
| `OPENAI_API_KEY` | 3 | For AI | OpenAI API key (Val Town std lib) |

---

## Discord API Reference

| Endpoint | Purpose | Gate |
|----------|---------|------|
| `GET /guilds/{guild_id}/channels` | List channels with topics | 0 |
| `GET /channels/{channel_id}/messages` | Fetch recent messages | 0 |
| `POST /channels/{channel_id}/messages/{message_id}/threads` | Create thread | 0 |
| `POST /channels/{thread_id}/messages` | Post summary (existing) | 3 |

---

## Polling Strategy

**Internal loop pattern** (Val Town cron minimum is 1 minute):
```typescript
export default async function() {
  const POLL_INTERVAL_MS = 5000;
  const RUN_DURATION_MS = 55000; // Leave 5s buffer before next cron
  const startTime = Date.now();
  
  while (Date.now() - startTime < RUN_DURATION_MS) {
    await pollAndProcessMessages();
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}
```

**Per-iteration logic:**
1. Fetch last ~20 messages from each `[autothread]` channel
2. Compare against `autothread_processed` table to find new messages
3. Use `last_message_id` in `autothread_channels` for efficient `after` parameter
4. Thread new messages immediately (optimistic insert prevents duplicates)
5. Gather last ~4 messages before target for AI context (if AI enabled)

**Snowflake math** (for `after` parameter optimization):
```typescript
const DISCORD_EPOCH = 1420070400000n; // 2015-01-01T00:00:00.000Z
const snowflake = ((BigInt(Date.now()) - DISCORD_EPOCH) << 22n).toString();
```

---

## Learnings & Artifacts

_Record discoveries, gotchas, and useful patterns here during implementation._

- [x] Discord `topic` field is the channel description
- [x] Thread starter messages have `thread` property when thread exists
- [x] Rate limits: process channels sequentially to avoid 429s
- [x] Gate 0: `getMessages()` returns newest-first; Gate 1 must sort by ID for chronological processing
- [x] Gate 0: Discord limits `getMessages` to 100 messages max per call
- [x] Gate 0: 429 response `retry_after` may be missing/malformed - added defensive parsing
- [x] Gate 1: Use insert-first (optimistic insert) for idempotency, not SELECT-then-INSERT (race window)
- [x] Gate 1: Only advance `last_message_id` cursor past messages fully handled to avoid message loss on caps
- [x] Gate 1: Always upsert channel state even when no new messages, so channels get registered
- [x] Gate 2: Pagination must go backwards (newest→oldest) to avoid missing messages when >limit arrive between polls
- [x] Gate 2: Use same sanitizeContent() for both validation and thread naming to ensure consistency
- [x] Gate 2: Dry-run inserts `status='dry_run'` rows - switching to live requires clearing/bumping tables
- [x] Gate 3: AI context must use full `allMessages` (incl. before cursor), not just `newMessages`
- [x] Gate 3: JSON parsing must handle code fences and extra text from LLM responses
- [x] Gate 3: Summary must be capped at 2000 chars (Discord message limit)
- [x] Gate 3: Thread name must be sanitized same as deterministic (sanitizeContent + 100 char limit)
- [x] Gate 4: `[autothread:quiet]` tag regex must match variants like `[autothread]`, `[autothread:quiet]`
- [x] Gate 4: Link-only filter must handle multiple links and Discord `<https://...>` format
- [x] Gate 4: Health endpoint needs `autothread_runs` table to track actual cron run status
- [x] Gate 4: Cooldown uses sliding window count from PROCESSED_TABLE (threads in last 10 min)

## Debug Infrastructure (Post-Gates)

Implemented a comprehensive debug console for testing in Val Town's deploy-to-prod environment.

### Key Features
- **Execution modes**: `plan` (no writes), `dry_run` (DB only), `live` (full)
- **Namespaces**: `sandbox` (isolated testing) vs `prod` (real data)
- **Manual triggers**: Run autothread on-demand via HTTP endpoints
- **Component testing**: Test Discord API, AI naming, gate evaluation in isolation
- **State inspection**: View and manipulate database state
- **Event logging**: Queryable run history with detailed events

### Files Added
- `backend/autothread/` - Refactored module structure
  - `types.ts` - Type definitions and config defaults
  - `store.ts` - Database operations with namespace support
  - `logic.ts` - Core processing logic
  - `runner.ts` - High-level runner
  - `README.md` - Documentation
- `backend/autothread-debug.http.ts` - Debug HTTP endpoints

### Endpoints
- `POST /api/autothread/debug/run` - Trigger debug run
- `GET /api/autothread/debug/state` - Inspect DB state
- `GET /api/autothread/debug/runs` - List run history
- `POST /api/autothread/debug/eval-message` - Test gate evaluation
- `POST /api/autothread/debug/generate-ai-name` - Test AI naming

See `backend/autothread/README.md` for full documentation.

### Deployment Notes

The debug console is currently on the `auto-threading` branch. To test it:

1. **Merge to main**: Use the Val Town web UI at https://www.val.town/x/colel/rust-nyc-talk-submissions/branch/auto-threading/code/ to merge into main
2. **After merge**, endpoints will be available at:
   - `https://rustnyc-talks.val.run/api/autothread/debug/`
   - `https://rustnyc-talks.val.run/api/autothread/health`

### Required Environment Variables

Set these in Val Town project settings:
- `ADMIN_TOKEN` - Bearer token for debug endpoints
- `ENABLE_TEST_API=true` - Enable debug endpoints
- `DISCORD_BOT_TOKEN` - Discord bot authentication
- `DISCORD_GUILD_ID` - Guild to monitor
- `OPENAI_API_KEY` - For AI naming (optional)

### Bug Fix Applied

Fixed export in `backend/autothread-debug.http.ts`:
- Changed `export default app.fetch` to `export default app`
- `app.route()` in Hono expects a Hono app instance, not a fetch function
