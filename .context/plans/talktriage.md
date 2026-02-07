# TalkTriage Implementation Plan

> **Interesting artifacts and learnings must be written back to this document.**

Plan status: **pre-beads**

## Goal & Motivation

Ship **TalkTriage**: a Discord-native, role-gated talk review pipeline.

Target outcome (MVP): each new submission generates a **review card** in a dedicated `#talk-triage` channel; authorized reviewers can vote, discuss in a thread, and **finalize** (accept/waitlist/decline) via a button-driven flow. Finalization posts a status update to the speaker's channel.

## Scope

### In-scope (MVP)
- Dedicated triage channel (config-driven)
- Role-gated reviewer actions (config-driven set of Discord role IDs)
- Review card message with interactive buttons (vote + discuss)
- Per-submission review thread (created on demand)
- "Action Panel" message in thread containing **Finalize** buttons (fallback: on card)
- Persisted votes + status + message/thread IDs in SQLite
- `/triage` slash command (queue view)
- Configurable threshold: default **≥3 accept votes** for "Recommendation" (and optional finalize gating)

### Explicitly out of scope (this plan)
- Full web admin dashboard
- Scheduling/availability flows (TalkSync)
- Anonymized review mode
- AI scoring / copilot
- Discord Gateway (websocket) event ingestion for emoji reaction tracking (we'll use Interactions/buttons)

### Dependencies / External setup
- Discord application configured with:
  - Interactions endpoint URL
  - Application commands (slash commands)
  - Bot token + permissions
  - Public key for signature verification
- Discord server has:
  - A dedicated `#talk-triage` channel
  - Reviewer roles whose IDs we can configure

## Codebase Context (existing)

| Area | Files | Notes |
|---|---|---|
| HTTP server | `backend/index.ts` | Hono app; current submission flow posts organizer notifications |
| Discord REST wrapper | `backend/discord.ts` | Currently supports createChannel/createInvite/sendMessage/listGuildChannels/getMessages/startThreadFromMessage |
| Message templates | `backend/messages.ts` | Plain-text templates only |
| Config | `backend/config.ts` | Reads Discord env vars; needs extension for TalkTriage env vars |
| Shared types | `shared/types.ts` | Current submission shape; TalkTriage types may be backend-only initially |
| Autothread patterns | `backend/autothread/*` | Useful patterns: debug endpoints, "plan/dry_run/live", safety guards |

## Architecture: Module Boundaries

### New Files (TalkTriage)

| File | Responsibility | Depends On |
|---|---|---|
| `backend/talktriage/index.ts` | Public API; re-exports service functions | service.ts, types.ts |
| `backend/talktriage/service.ts` | Business logic: createReviewCard, recordVote, finalize, getQueue | db.ts, discord.ts (via interface) |
| `backend/talktriage/db.ts` | DB queries; no business logic or Discord calls | sqlite |
| `backend/talktriage/types.ts` | TalkTriage-specific types (not shared with frontend) | — |
| `backend/talktriage/messages.ts` | Embed/component builders for review cards and notifications | types.ts |
| `backend/talktriage/interactions.ts` | Hono route: signature verify, routing, role gating | service.ts |

### Layering Rules

1. **Routes** (`interactions.ts`, `backend/index.ts`) → call **Service** (`service.ts`)
2. **Service** → orchestrates **DB** (`db.ts`) + **Discord** (`backend/discord.ts`)
3. **DB** and **Discord** are leaf dependencies; they do NOT call each other
4. **Messages** (`messages.ts`) builds payloads; called by Service before Discord calls

### Dependency Direction

```
backend/index.ts (submission flow)
        │
        ▼ optional integration via interface
backend/talktriage/service.ts
        │
   ┌────┴────┐
   ▼         ▼
db.ts    discord.ts (existing)
```

**Optional integration contract** — Submission flow calls TalkTriage through a single function:

```ts
// In backend/talktriage/index.ts
export async function onSubmissionCreated(submission: TalkSubmission): Promise<void>
```

If TalkTriage is disabled (missing config), this function no-ops. The submission flow does NOT import db.ts or messages.ts directly—only the public `onSubmissionCreated` entrypoint.

## Contracts: Key Interfaces

### Review Card Message Structure

Built by `backend/talktriage/messages.ts`, consumed by `backend/discord.ts`:

```ts
interface ReviewCardPayload {
  embeds: [{
    title: string;           // "🎤 Talk Submission #42"
    description?: string;    // Excerpt of talk_context (truncate to fit embed limits)
    color: number;           // Status-based: pending=gray, reviewing=blue, accepted=green, etc.
    fields: [
      { name: "Speaker", value: string, inline: true },
      { name: "Submission", value: string, inline: true },  // "Self" | "On behalf of …"
      { name: "Status", value: string, inline: true },
      { name: "Votes", value: string, inline: false },  // "✅ 2 | 🤔 1 | ❌ 0"
      { name: "Recommendation", value: string, inline: false },  // Only when threshold met
      { name: "Speaker Channel", value: string, inline: false },  // "<#channel_id>"
    ];
    footer: { text: string };  // "Submitted {relative_time}"
  }];
  components: [ActionRow, ActionRow?];  // Row 1: Vote buttons + Discuss; Row 2 (fallback): Finalize buttons if no thread
}
```

### Button custom_id Schema

Format: `talktriage:<action>:<param1>:<param2>...`

| Action | Format | Example |
|---|---|---|
| Vote | `talktriage:vote:<vote_type>:<submission_id>` | `talktriage:vote:accept:42` |
| Discuss | `talktriage:discuss:<submission_id>` | `talktriage:discuss:42` |
| Finalize | `talktriage:finalize:<status>:<submission_id>` | `talktriage:finalize:accepted:42` |

**Validation:** Parse with `custom_id.split(':')`, validate prefix is `talktriage`, action is in whitelist, and `submission_id` parses to a finite integer that exists in DB.

### Interaction Response Types

| Scenario | Response Type | Body |
|---|---|---|
| PING | `1` (PONG) | `{ type: 1 }` |
| Immediate ack (fast op) | `4` (CHANNEL_MESSAGE_WITH_SOURCE) | `{ type: 4, data: { content, flags } }` |
| Deferred (slow op) | `5` or `6` | `{ type: 5 }` or `{ type: 6 }` |
| Ephemeral error | `4` | `{ type: 4, data: { content, flags: 64 } }` |
| Update original | Follow-up PATCH | `PATCH /webhooks/{app_id}/{token}/messages/@original` |

### Service Layer Function Signatures

```ts
// backend/talktriage/service.ts
export async function createReviewCard(submission: TalkSubmission): Promise<{ messageId: string }>
export async function recordVote(submissionId: number, reviewerId: string, vote: Vote): Promise<Tally>
export async function startDiscussion(submissionId: number): Promise<{ threadId: string }>
export async function finalize(submissionId: number, status: FinalStatus, byDiscordId: string): Promise<FinalizeResult>
export async function getQueue(filter?: StatusFilter): Promise<QueueItem[]>

type Vote = 'accept' | 'maybe' | 'pass'
type FinalStatus = 'accepted' | 'waitlisted' | 'declined'
type FinalizeResult = { success: true } | { success: false; reason: 'already_finalized'; currentStatus: FinalStatus }
```

## Controversial forks (none remaining)

- **Decision locked for MVP:** Use Discord **Interactions** (slash commands + buttons) instead of emoji reaction tracking.
  - Rationale: Val Town + serverless favors HTTP callbacks; finalize buttons require Interactions anyway.

---

## Gates

### Gate: TalkTriage Configuration + Discord prerequisites

**Owner:** `backend/config.ts`

**Deliverables**
- Env var contract documented
- `backend/config.ts` extended to export `getTalkTriageConfig()` returning typed config or `null` if disabled

**Config additions (proposed)**
- `DISCORD_TRIAGE_CHANNEL_ID` (required)
- `DISCORD_REVIEWER_ROLE_IDS` (required; comma-separated)
- `DISCORD_PUBLIC_KEY` (required; interactions signature verification)
- `TALKTRIAGE_MIN_ACCEPT_VOTES` (optional; default `3`)
- `TALKTRIAGE_ENABLE_FINALIZE_GATING` (optional; if true, only enable finalize when threshold met)

**Acceptance criteria**
- Startup logs clearly show which TalkTriage features are enabled and what's missing
- Misconfiguration fails safely (TalkTriage disabled but submissions still work)

**Verification**
- Manual: deploy with missing vars → see placeholder/disabled logs; submit still succeeds
- Manual: deploy with all vars → logs show "TalkTriage enabled"

---

### Gate: Database schema for TalkTriage

**Owner:** `backend/talktriage/db.ts` (DB layer; no business logic)

**Deliverables**
- SQLite tables created at startup (migration code in `backend/talktriage/db.ts`, called from `backend/index.ts`)

**Tables (MVP)**
- `talktriage_review_cards_1` (submission_id PK, triage_channel_id, review_message_id, review_thread_id?, created_at)
- `talktriage_votes_1` (submission_id, reviewer_discord_id, vote, updated_at; UNIQUE(submission_id, reviewer_discord_id))
- `talktriage_status_1` (submission_id PK, status, updated_at, updated_by_discord_id)
- `talktriage_status_history_1` (id AUTOINCREMENT, submission_id, old_status, new_status, changed_by_discord_id, changed_at) — append-only transitions

**Indexes (required for queue queries)**
- `CREATE INDEX idx_votes_submission ON talktriage_votes_1(submission_id)` — tally aggregation
- `CREATE INDEX idx_status_status ON talktriage_status_1(status)` — `/triage` filtering by status
- `CREATE INDEX idx_cards_created ON talktriage_review_cards_1(created_at)` — queue ordering

**Acceptance criteria**
- Tables exist; inserts/updates are idempotent
- Constraints prevent double votes per reviewer
- Indexes exist (verify via `.schema` or EXPLAIN QUERY PLAN)

**Verification**
- Manual: hit `/api/submissions` once in test env → see rows in `talktriage_*` tables

---

### Gate: Discord REST enhancements for interactive messages

**Owner:** `backend/discord.ts` (shared Discord layer)

**Deliverables**
Extend `backend/discord.ts` to support the primitives TalkTriage needs.

**Additions (proposed)**
- `sendMessageWithComponents(channelId, payload: ReviewCardPayload)` — see **Contracts: Review Card Message Structure**
- `editMessage(channelId, messageId, payload)` — to update tally/status
- Create thread from message (already exists)

**Acceptance criteria**
- Able to post a message containing components (buttons)
- Able to edit that message later

**Verification**
- Manual: a debug endpoint posts a sample component message to a test channel; clicking buttons triggers interactions (once Gate: interactions endpoint exists)

---

### Gate: Discord Interactions endpoint (foundation)

**Owner:** `backend/talktriage/interactions.ts` (mounts to `backend/index.ts` Hono app)

**Deliverables**
- New Hono route: `POST /api/discord/interactions`
- Signature verification (Ed25519) using `DISCORD_PUBLIC_KEY`
- Handle Discord `PING` interaction

**Security: Signature Verification**
- Use `discord-interactions` npm package via esm.sh (`https://esm.sh/discord-interactions`) for `verifyKey()`
- Verification MUST happen before any payload parsing or routing
- Implementation pattern:
  ```ts
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  const body = await c.req.text();
  if (!verifyKey(body, signature, timestamp, DISCORD_PUBLIC_KEY)) {
    return c.text("Invalid signature", 401);
  }
  ```

**Architecture: 3-second response constraint**
- Discord terminates interactions after 3 seconds without response
- For any operation that may exceed 1.5s (DB writes + Discord API calls), use deferred response pattern:
  1. Immediately respond with `{ type: 5 }` or `{ type: 6 }` (see below)
  2. Perform slow operations
  3. Call `PATCH /webhooks/{app_id}/{interaction_token}/messages/@original` to update
- **Type 5 vs Type 6:**
  - Type 5 (`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`): Use for slash commands (e.g., `/triage`) — shows "Bot is thinking..."
  - Type 6 (`DEFERRED_UPDATE_MESSAGE`): Use for button clicks that will update the originating message (e.g., vote buttons updating card tally)
- Val Town HTTP handlers have 30s timeout; deferred pattern keeps Discord happy within that

**Acceptance criteria**
- Discord can successfully "ping" the endpoint and receive the correct response
- Invalid signature requests are rejected with 401 before any processing

**Verification**
- Manual: configure endpoint in Discord developer portal; observe successful verification
- Manual: curl with invalid sig → 401 (no log noise from payload parsing)

---

### Gate: Command + Component routing (TalkTriage router)

**Owner:** `backend/talktriage/interactions.ts` (route layer → calls Service)

**Deliverables**
- Interaction router that dispatches:
  - slash commands: `/triage` → `service.getQueue()`
  - component clicks: vote/discuss/finalize buttons → corresponding service functions
- Role gating: only members whose `member.roles` intersects `DISCORD_REVIEWER_ROLE_IDS` may act
- Parse `custom_id` per **Contracts: Button custom_id Schema**

**Security: Role validation strategy**
- **Use interaction payload roles** (`interaction.member.roles[]`) — Discord guarantees freshness at interaction time
- Do NOT re-fetch member via API (adds latency, rate limit risk, no security benefit)
- Parse `DISCORD_REVIEWER_ROLE_IDS` once at startup; store as `Set<string>` for O(1) lookup
- Authorization check: `interaction.member.roles.some(r => reviewerRoleSet.has(r))`
- Log denied attempts with `user.id` and `user.username` for audit trail

**Security: Input validation**
- `custom_id` format: use structured IDs like `talktriage:vote:accept:<submission_id>` 
- Validate `custom_id` prefix matches expected action; reject unknown prefixes with 400
- Validate `submission_id` exists in DB before processing; respond with ephemeral error if not found
- Vote values: whitelist `accept`, `maybe`, `pass` only

**Acceptance criteria**
- Unauthorized user gets ephemeral "no permission"
- Authorized user action routes successfully
- Malformed `custom_id` returns 400, not 500

**Verification**
- Manual: test with two users: reviewer and non-reviewer
- Manual: craft invalid `custom_id` via debug endpoint → see 400 + safe log

---

### Gate: Create review card on submission

**Owner:** `backend/index.ts` calls `onSubmissionCreated()` → `backend/talktriage/service.ts`

**Deliverables**
- `backend/index.ts`: add call to `onSubmissionCreated(submission)` after successful submission (see **Architecture: Module Boundaries**)
- `backend/talktriage/service.ts`: implement `createReviewCard()` which:
  - Creates initial status (`pending`) in DB
  - Builds payload via `messages.ts` (see **Contracts: Review Card Message Structure**)
  - Posts review card to `DISCORD_TRIAGE_CHANNEL_ID` via `discord.ts`
  - Stores `review_message_id` in `talktriage_review_cards_1`

**Architecture: Idempotency strategy**
- If submission handler retries after partial failure:
  - Don't create duplicate review cards
  - Pattern: check DB first, create only if missing
  ```
  1. BEGIN (implicit in Val Town SQLite)
  2. SELECT review_message_id FROM talktriage_review_cards_1 WHERE submission_id = ?
  3. IF exists: skip creation, return existing message_id
  4. ELSE: post message to Discord, INSERT row, return new message_id
  ```
- Risk: crash between Discord post and DB insert → orphan message in channel
- Mitigation: `/talktriage rebuild` can reconcile by searching triage channel for orphan cards (see Operational hardening gate)

**Concurrency: Rapid duplicate submissions**
- Edge case: two HTTP requests for same submission ID arrive simultaneously (network retry, double-click)
- Val Town SQLite serializes writes; second INSERT will fail on PK constraint
- Pattern: wrap INSERT in try/catch; on constraint violation, return existing row (treat as success)
- Discord may receive two card posts in race window; orphan cleanup via rebuild command

**Acceptance criteria**
- Every new submission produces exactly one triage card
- Card includes links to the speaker channel

**Verification**
- Manual: submit twice → two distinct cards; re-run same submission ID is impossible through public API but can be simulated via internal debug endpoint

---

### Gate: Voting + tally + recommendation

**Owner:** `backend/talktriage/service.ts` — `recordVote()` function (see **Contracts: Service Layer Function Signatures**)

**Deliverables**
- `recordVote()` upserts `talktriage_votes_1` via `db.ts`, returns `Tally`
- `interactions.ts` calls `recordVote()`, then edits card to show:
  - tally counts
  - recommendation when `accept >= TALKTRIAGE_MIN_ACCEPT_VOTES`
- Optional: move `pending → reviewing` on first vote

**Architecture: Concurrency handling**
- SQLite upsert pattern: `INSERT INTO talktriage_votes_1 ... ON CONFLICT(submission_id, reviewer_discord_id) DO UPDATE SET vote=excluded.vote, updated_at=excluded.updated_at`
- Tally query must run AFTER upsert completes (not cached); use `SELECT vote, COUNT(*) FROM talktriage_votes_1 WHERE submission_id=? GROUP BY vote`
- Val Town SQLite is single-writer; concurrent requests serialize automatically—no explicit locking needed
- Message edit is eventually consistent: if two votes arrive simultaneously, last edit wins (tally will be correct)

**Architecture: Partial failure handling**
- Order of operations: 1) DB upsert 2) compute tally 3) edit Discord message
- If Discord edit fails after DB write: vote is persisted correctly; card shows stale tally until next interaction
- Return success to user even if card edit fails (vote was recorded); log warning for monitoring
- Consider: `/triage rebuild <id>` can force re-render of card from DB state (see Operational hardening gate)

**Architecture: Discord API transient failure handling**
- Discord REST calls may fail with 5xx or network errors
- Retry strategy: single immediate retry with 500ms delay for 5xx/network errors only (not 4xx)
- Implementation: wrap Discord calls in `retryOnce(fn, { retryOn: [500, 502, 503, 504] })`
- If retry fails: log error with `submission_id` + `discord_error_code`, return ephemeral "Temporary error, please retry"
- Rate limit (429): respect `Retry-After` header if present; otherwise back off 1s. Log `rate_limit` event for monitoring

**Acceptance criteria**
- Votes are per-reviewer; clicking a different vote overwrites their prior vote
- Tally is correct under concurrent clicks
- Threshold is configurable

**Verification**
- Manual: 3 reviewers click ✅ → card shows recommendation
- Manual: one reviewer clicks 🤔 → maybe count increments and recommendation may change accordingly
- Manual: one reviewer changes to ❌ → counts update correctly
- Manual: simulate Discord API timeout after vote → vote persisted, user sees ephemeral ack, card eventually updates

---

### Gate: Discuss thread + Action Panel + Finalize

**Owner:** `backend/talktriage/service.ts` — `startDiscussion()` + `finalize()` (see **Contracts: Service Layer Function Signatures**)

**Deliverables**
- `startDiscussion()`: creates thread (if missing), posts/pins:
  - talk summary
  - Action Panel message with finalize buttons
- **Discuss button behavior:**
  - If thread does not exist: create thread, post summary + Action Panel, return thread link
  - If thread already exists: return existing thread link (no duplicate posts)
  - Response: ephemeral message with "View discussion: <#thread_id>" link

**Concurrency: Thread creation race**
- Two users clicking Discuss simultaneously may both attempt thread creation
- Pattern: check DB for `review_thread_id` first; if NULL, create thread, then upsert thread ID
- Use upsert: `UPDATE talktriage_review_cards_1 SET review_thread_id=? WHERE submission_id=? AND review_thread_id IS NULL`
- If affected rows = 0, another request won; re-query DB for the winning thread ID
- Discord tolerates duplicate `startThreadFromMessage` calls (returns existing thread), so worst case is two API calls, not two threads

- Finalize buttons:
  - Validate role
  - Validate state transition
  - Update `talktriage_status_1` + append `status_history`
  - Edit triage card: update status badge + **disable all buttons** (set `disabled: true` in component payload)
  - Post speaker notification in speaker channel

**Security: State transition validation**
- Before finalize: query `talktriage_status_1` for current status
- Valid transitions only: `pending|reviewing → accepted|waitlisted|declined`
- Reject finalize on already-finalized submissions with ephemeral "Already finalized as {status}"
- Use optimistic locking: `UPDATE ... WHERE submission_id=? AND status IN ('pending','reviewing')` — check affected rows = 1
- If affected rows = 0, another finalizer won the race; return ephemeral "Already finalized" (not an error)

**Architecture: Speaker channel lookup**
- Existing flow stores speaker channel in `talk_submissions_3.channel_id` (created on submission)
- Finalize handler: query `SELECT channel_id FROM talk_submissions_3 WHERE id = ?`
- If channel_id is NULL or channel was deleted: log warning, skip speaker notification, still mark finalized
- Speaker notification is best-effort; finalize succeeds even if notification fails

**Finalize gating (optional)**
- If `TALKTRIAGE_ENABLE_FINALIZE_GATING=true`:
  - Finalize buttons in Action Panel render with `disabled: true` until `accept_votes >= TALKTRIAGE_MIN_ACCEPT_VOTES`
  - When threshold is met: `service.recordVote()` also updates Action Panel message (if thread exists) to enable buttons
  - Non-gated mode (default): finalize buttons always enabled; threshold only controls "Recommendation" badge visibility

**Fallback: Finalize without thread**
- If thread creation fails (Discord API error) or Discuss was never clicked:
  - Finalize buttons remain on the review card (in `components` ActionRow)
  - User can finalize directly from card; no thread required
  - Thread is a convenience, not a prerequisite for finalization

**Acceptance criteria**
- Finalize is explicit; produces one status change
- Speaker channel receives appropriate message
- Finalize works even if no thread exists (buttons on card)
- Double-finalize attempts get clear ephemeral message, not error

**Verification**
- Manual: click Discuss, see thread + action panel
- Manual: click Finalize: Accept; see speaker update + triage card status change
- Manual: click Finalize again → ephemeral "Already finalized as accepted"

---

### Gate: `/triage` command (queue view)

**Owner:** `backend/talktriage/interactions.ts` → `service.getQueue()`

**Deliverables**
- `getQueue()` returns `QueueItem[]` (see **Contracts: Service Layer Function Signatures**)
- `interactions.ts` formats as ephemeral Discord message grouped by status
- Includes aging (days since submission) and quick links
- **Slash command registration:** One-time manual step via Discord API or developer portal:
  - Register global command: `POST /applications/{app_id}/commands` with:
    ```json
    {
      "name": "triage",
      "description": "View talk submission queue",
      "options": [{
        "name": "status",
        "description": "Filter by status",
        "type": 3,
        "required": false,
        "choices": [
          { "name": "pending", "value": "pending" },
          { "name": "reviewing", "value": "reviewing" },
          { "name": "accepted", "value": "accepted" },
          { "name": "waitlisted", "value": "waitlisted" },
          { "name": "declined", "value": "declined" }
        ]
      }]
    }
    ```
  - Document in README (see Operational hardening gate)

**Performance: Pagination and size limits**
- Default limit: 25 items per `/triage` call (covers typical backlog)
- If queue > 25: show first 25 + footer "Showing 25 of {total}. Use `/triage status:pending` to filter."
- Query uses indexed `status` column + `ORDER BY created_at ASC LIMIT 26` (fetch 26 to detect overflow)
- Message formatting: each item ~60 chars → 25 items ≈ 1500 chars (well under 2000 limit)

**Acceptance criteria**
- Only authorized roles can use `/triage` (role check in `interactions.ts`)
- Output is readable on mobile (≤2000 chars, no wide tables)
- Large queues don't timeout or truncate unexpectedly

**Verification**
- Manual: run `/triage` with 5+ submissions in mixed states

---

### Gate: Operational hardening + docs

**Owner:** `backend/talktriage/service.ts` (rebuild logic), `README.md` (docs)

**Deliverables**
- Failure recovery:
  - If card exists but message was deleted: admin-only `/talktriage rebuild <id>` (or a debug endpoint) to re-post and re-link
  - If interactions fail: safe error messages + logs
- Rate limiting / spam prevention for interactions endpoint (basic)
- Documentation updates:
  - README env vars
  - "How to register commands" runbook

**Rebuild command scope (`/talktriage rebuild <submission_id>` or debug endpoint `POST /api/talktriage/rebuild/:id`)**
- Idempotent operation; safe to run multiple times
- Actions performed:
  1. Query DB for submission + current status + vote tally
  2. If `review_message_id` exists: attempt to edit existing card (may 404 if deleted)
  3. If edit 404s: post new card to triage channel, update `review_message_id` in DB
  4. If `review_thread_id` exists but thread deleted: clear thread ID in DB (thread re-created on next Discuss click)
  5. Log all mutations with `rebuild` event type
- Does NOT affect: finalized status, vote history, speaker notifications (past actions are immutable)

**Structured error codes (for logging and debugging)**
| Code | Meaning | User-facing message |
|---|---|---|
| `TRIAGE_001` | Signature verification failed | (no response—401) |
| `TRIAGE_002` | Unauthorized role | "You don't have permission to do this." |
| `TRIAGE_003` | Submission not found | "Submission not found." |
| `TRIAGE_004` | Already finalized | "Already finalized as {status}." |
| `TRIAGE_005` | Discord API error (after retry) | "Temporary error, please retry." |
| `TRIAGE_006` | Invalid custom_id format | (400—malformed request) |

Log format: `[TRIAGE_XXX] {message} | submission_id={id} user_id={uid}`

**Security: Rate limiting strategy**
- Primary defense: Discord signature verification rejects forged requests (no external abuse vector)
- Secondary defense: Discord's own rate limits on user interactions (users can't spam buttons faster than Discord allows)
- Application-level: no additional rate limiting required for MVP—all requests are authenticated Discord interactions
- Future consideration: if `/triage` command becomes expensive, add per-user cooldown (e.g., 1 request per 10s stored in memory or blob)

**Acceptance criteria**
- No hard crash on malformed interactions
- Clear logs to debug problems

**Verification**
- Manual: simulate deleted review card → rebuild works
- Manual: send malformed payload → 400 + safe log

---

## Learnings & Artifacts (write back during execution)

- [x] Deno/Val Town signature verification library choice and gotchas → Use `discord-interactions` via esm.sh; see Gate: Discord Interactions endpoint
- [ ] Discord component payload limits and layout constraints
- [x] Interaction response timing constraints (3s) and any need for deferred responses → Use deferred pattern for slow ops; see Gate: Discord Interactions endpoint
- [x] Best practice for storing `member.roles` vs re-fetching member state → Trust interaction payload roles; see Gate: Command + Component routing
