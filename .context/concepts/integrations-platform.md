# Rust NYC Integrations Platform: "Connect"

> **Status**: PR-Ready Concept  
> **Author**: Integration Design Task  
> **Date**: 2026-02-06

---

## Executive Summary

**Connect** is a first-party integrations platform for the Rust NYC Talk Submission System. It provides a unified, secure interface for external tools to access talk data, receive real-time notifications, and export schedules—enabling organizers to build custom workflows without modifying the core system.

---

## 1. Core Primitives

### 1.1 API Keys

| Field | Description |
|-------|-------------|
| `key_id` | Public identifier (prefix: `rnc_`) |
| `key_hash` | bcrypt hash of secret portion |
| `name` | Human-readable label |
| `scopes` | Permission array: `["submissions:read", "webhooks:manage", "exports:create"]` |
| `created_by` | Discord user ID of creator |
| `expires_at` | Optional expiration timestamp |
| `last_used_at` | Audit timestamp |

**Key format**: `rnc_live_<24-char-random>` (production) / `rnc_test_<24-char-random>` (test mode)

**Schema addition** (`backend/index.ts`, new table):
```sql
CREATE TABLE IF NOT EXISTS api_keys_1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT UNIQUE NOT NULL,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,  -- JSON array
  created_by TEXT NOT NULL,
  expires_at DATETIME,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 1.2 Webhooks

| Field | Description |
|-------|-------------|
| `id` | Auto-increment ID |
| `url` | HTTPS endpoint (must be TLS) |
| `events` | Array: `["submission.created", "submission.updated", "talk.scheduled"]` |
| `secret` | HMAC-SHA256 signing secret |
| `api_key_id` | Owning API key |
| `active` | Boolean toggle |
| `failure_count` | Consecutive failures (disable at 10) |

**Webhook payload structure**:
```json
{
  "event": "submission.created",
  "timestamp": "2026-02-06T13:57:40Z",
  "data": { /* TalkSubmission object */ },
  "signature": "sha256=..."
}
```

**Schema addition**:
```sql
CREATE TABLE IF NOT EXISTS webhooks_1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  events TEXT NOT NULL,  -- JSON array
  secret TEXT NOT NULL,
  api_key_id INTEGER REFERENCES api_keys_1(id),
  active BOOLEAN DEFAULT true,
  failure_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 2. API Endpoints

All endpoints require `Authorization: Bearer rnc_live_...` header.

### 2.1 Read Operations

| Endpoint | Scope | Description |
|----------|-------|-------------|
| `GET /api/v1/submissions` | `submissions:read` | List all submissions with pagination |
| `GET /api/v1/submissions/:id` | `submissions:read` | Get single submission |
| `GET /api/v1/schedule` | `submissions:read` | Get scheduled talks with dates |

### 2.2 Export Operations

| Endpoint | Scope | Format |
|----------|-------|--------|
| `GET /api/v1/exports/submissions.csv` | `exports:create` | CSV download |
| `GET /api/v1/exports/submissions.json` | `exports:create` | JSON array |
| `GET /api/v1/exports/schedule.ics` | `exports:create` | iCalendar feed |

**CSV columns**: `id,speaker_name,talk_context,is_on_behalf,submitter_name,discord_channel_id,created_at,scheduled_date`

### 2.3 Webhook Management

| Endpoint | Scope | Description |
|----------|-------|-------------|
| `POST /api/v1/webhooks` | `webhooks:manage` | Register new webhook |
| `GET /api/v1/webhooks` | `webhooks:manage` | List webhooks |
| `DELETE /api/v1/webhooks/:id` | `webhooks:manage` | Remove webhook |
| `POST /api/v1/webhooks/:id/test` | `webhooks:manage` | Send test event |

---

## 3. Example Integrations

### 3.1 Notion Database Sync

```typescript
// Zapier/Make webhook handler
app.post("/api/webhooks/notion-sync", async (c) => {
  const payload = await c.req.json();
  if (payload.event === "submission.created") {
    await notionClient.pages.create({
      parent: { database_id: NOTION_DB_ID },
      properties: {
        "Speaker": { title: [{ text: { content: payload.data.speaker_name }}] },
        "Context": { rich_text: [{ text: { content: payload.data.talk_context }}] },
        "Discord": { url: payload.data.discord_invite_link },
        "Status": { select: { name: "New" } }
      }
    });
  }
});
```

### 3.2 Google Sheets Export

```bash
# Cron job or manual trigger
curl -H "Authorization: Bearer rnc_live_..." \
  "https://rustnyc-talks.val.run/api/v1/exports/submissions.csv" \
  | google-sheets-append --spreadsheet-id=... --sheet="Submissions"
```

### 3.3 Calendar Integration

```html
<!-- Subscribe to iCal feed -->
<a href="webcal://rustnyc-talks.val.run/api/v1/exports/schedule.ics?key=rnc_live_...">
  Add to Calendar
</a>
```

### 3.4 Slack Notification Bot

```typescript
// Webhook endpoint receives events
async function handleWebhook(event: WebhookPayload) {
  if (event.event === "talk.scheduled") {
    await slack.chat.postMessage({
      channel: "#rust-nyc-talks",
      text: `📅 "${event.data.speaker_name}" scheduled for ${event.data.scheduled_date}!`,
      unfurl_links: false
    });
  }
}
```

---

## 4. Security Model

### 4.1 Authentication

1. **API Key validation**: Extract from `Authorization: Bearer` header
2. **Hash verification**: Compare bcrypt hash against stored `key_hash`
3. **Expiration check**: Reject if `expires_at < NOW()`
4. **Scope enforcement**: Check required scope for endpoint

### 4.2 Webhook Security

1. **TLS only**: Reject non-HTTPS URLs at registration
2. **HMAC signing**: `X-Signature: sha256=HMAC(secret, rawBody)`
3. **Timestamp header**: `X-Timestamp` for replay protection (5-min window)
4. **Auto-disable**: Deactivate webhook after 10 consecutive failures

### 4.3 Rate Limiting

| Scope | Limit |
|-------|-------|
| Per API key | 100 req/min |
| Webhook deliveries | 10 req/sec per endpoint |
| Export endpoints | 10 req/hour |

### 4.4 Audit Logging

```sql
CREATE TABLE IF NOT EXISTS api_audit_log_1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id INTEGER,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Success Metrics

| Metric | Target (90 days) | Measurement |
|--------|------------------|-------------|
| API keys created | 10+ | COUNT in `api_keys_1` |
| Webhooks registered | 5+ | COUNT in `webhooks_1` |
| Export downloads/week | 20+ | Audit log COUNT |
| Webhook delivery success rate | >99% | Failures / Total |
| P95 API latency | <200ms | Timing middleware |
| Integration partners mentioned | 2+ | Manual tracking |

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] API key table + CRUD endpoints
- [ ] Auth middleware (`backend/middleware/auth.ts`)
- [ ] Basic `GET /api/v1/submissions` with API key auth

### Phase 2: Exports (Week 2)
- [ ] CSV export endpoint
- [ ] JSON export endpoint
- [ ] iCalendar feed (requires `scheduled_date` column)

### Phase 3: Webhooks (Week 3)
- [ ] Webhook registration endpoints
- [ ] Event dispatch on submission create (`backend/index.ts:70-90`)
- [ ] Retry logic with exponential backoff
- [ ] Signature verification guide

### Phase 4: Polish (Week 4)
- [ ] Rate limiting middleware
- [ ] Audit logging
- [ ] Developer documentation page
- [ ] API key management UI (organizer-only)

---

## 7. Type Additions

**File**: `shared/types.ts` (add after line 24)

```typescript
// --- Integrations Platform Types ---

export type ApiKeyScope = "submissions:read" | "webhooks:manage" | "exports:create";

export interface ApiKey {
  id: number;
  key_id: string;  // e.g., "rnc_live_abc123..."
  name: string;
  scopes: ApiKeyScope[];
  created_by: string;
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
}

export type WebhookEvent = "submission.created" | "submission.updated" | "talk.scheduled";

export interface Webhook {
  id: number;
  url: string;
  events: WebhookEvent[];
  api_key_id: number;
  active: boolean;
  failure_count: number;
  created_at: string;
}

export interface WebhookPayload<T = TalkSubmission> {
  event: WebhookEvent;
  timestamp: string;
  data: T;
  signature: string;
}

export interface ExportOptions {
  format: "csv" | "json" | "ics";
  since?: string;  // ISO date filter
  status?: "pending" | "scheduled" | "all";
}
```

---

## 8. Mock Press Release Outline

### Title
**Rust NYC Launches "Connect" — Open API for Community Tool Integrations**

### Subhead
*Organizers can now sync talks to Notion, export to Sheets, and receive real-time Slack notifications*

### Lead Paragraph
- Rust NYC announces Connect, an API platform enabling organizers and community members to integrate talk submissions with their existing tools
- Available today with CSV/JSON exports, iCalendar feeds, and webhooks

### Key Features (bullets)
- 🔑 Secure API keys with granular scopes
- 📤 One-click CSV/JSON exports for spreadsheets
- 📅 Subscribe to iCal feed in Google/Apple Calendar
- 🔔 Webhooks for real-time notifications to Slack, Discord, custom bots
- 🔒 HMAC-signed payloads, TLS-only, automatic rate limiting

### Quote (Organizer)
> "We used to manually copy submissions into Notion every week. Now they appear automatically within seconds."

### Availability
- API documentation: `https://rustnyc-talks.val.run/docs/api`
- API keys: Request via Discord #organizers channel
- No cost for community use

### Call to Action
Join Rust NYC Discord to request an API key and start building integrations today.

---

## Remaining Work

1. **Schema migration**: Add `scheduled_date` column to `talk_submissions_3` (required for calendar feed)
2. **Organizer auth**: Decide how organizers authenticate to create API keys (Discord OAuth or shared admin key)
3. **Documentation site**: Static `/docs/api` page with OpenAPI spec or Markdown
4. **Webhook queue**: Consider async job queue for reliability (Val Town cron for retries?)
5. **Key rotation UI**: Endpoint to revoke and regenerate keys without data loss
