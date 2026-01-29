# Autothread Debug Console

A testing and debugging infrastructure for the autothread system that enables rapid iteration in Val Town's deploy-to-prod environment.

## Quick Start

1. Set environment variables:
   ```
   ADMIN_TOKEN=your-secret-token
   ENABLE_TEST_API=true
   ```

2. Test in sandbox mode (default - no side effects):
   ```bash
   curl -X POST https://your-val.val.run/api/autothread/debug/run \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"mode": "plan"}'
   ```

## Concepts

### Execution Modes

| Mode | Discord Writes | DB Writes | Use Case |
|------|----------------|-----------|----------|
| `plan` | ❌ | ❌ | See what *would* happen without any changes |
| `dry_run` | ❌ | ✅ | Test DB logic (cursors, claims) without Discord |
| `live` | ✅ | ✅ | Actually create threads |

### Namespaces

| Namespace | Tables | Use Case |
|-----------|--------|----------|
| `sandbox` | `*_sandbox` | Testing - isolated from production |
| `prod` | `*` | Real data - requires explicit confirmation |

### Safety Guards

- Default: `mode=plan`, `namespace=sandbox`
- `live` + `prod` requires `confirm: "LIVE_PROD"`
- Resetting prod is blocked
- Caps are enforced server-side (max 3 iterations, 5 threads)

## Endpoints

### Run Control

#### `POST /run`
Trigger an autothread run with custom configuration.

```json
{
  "mode": "plan|dry_run|live",
  "namespace": "sandbox|prod",
  "enableAI": false,
  "allowlist": ["channel_id_1", "channel_id_2"],
  "maxChannels": 1,
  "maxThreads": 2,
  "iterations": 1,
  "durationMs": 10000,
  "confirm": "LIVE_PROD"  // Required for live+prod
}
```

Response includes:
- `result.plannedActions[]` - What would/did happen
- `result.events[]` - Detailed event log
- `result.threadsCreated`, `result.errorCount`

### State Inspection

#### `GET /state?namespace=sandbox`
Returns channels, recent processed messages, and today's stats.

#### `GET /runs?namespace=sandbox&limit=10`
List recent runs with their status.

#### `GET /runs/:id/events?namespace=sandbox`
Get detailed events for a specific run.

### State Manipulation

#### `POST /reset`
Reset all sandbox state.
```json
{"namespace": "sandbox", "confirm": "RESET_SANDBOX"}
```

#### `POST /reset-cursor`
Reset a channel's last_message_id cursor.
```json
{"namespace": "sandbox", "channelId": "123", "lastMessageId": null}
```

#### `POST /clear-processed`
Clear processed messages with filters.
```json
{"namespace": "sandbox", "channelId": "123", "status": "dry_run"}
```

### Component Testing

#### `GET /discord/channels`
Test Discord API connectivity. Returns all guild channels.

#### `GET /discord/messages?channelId=123&limit=20`
Fetch messages from a channel.

#### `POST /eval-message`
Test gate evaluation on a message.
```json
{"content": "Hello world, this is a test message", "isBot": false}
```
or
```json
{"channelId": "123", "messageId": "456"}
```

#### `POST /generate-name`
Test deterministic thread naming.
```json
{"content": "This is a long message that will be truncated for the thread name"}
```

#### `POST /generate-ai-name`
Test AI thread naming (requires OPENAI_API_KEY).
```json
{
  "content": "Can someone help me with Rust lifetimes?",
  "context": [
    {"author": "alice", "content": "I'm stuck on this borrow checker error"},
    {"author": "bob", "content": "What does the error say?"}
  ]
}
```

## Workflow Examples

### 1. Initial Testing
```bash
# See what the system would do
curl -X POST .../debug/run -d '{"mode":"plan"}' -H "Authorization: Bearer $TOKEN"

# Check planned actions
# Look at result.plannedActions
```

### 2. Test DB Logic
```bash
# Run with DB writes but no Discord
curl -X POST .../debug/run -d '{"mode":"dry_run"}' -H "..."

# Inspect state
curl .../debug/state -H "..."

# Reset and try again
curl -X POST .../debug/reset -d '{"confirm":"RESET_SANDBOX"}' -H "..."
```

### 3. Test Specific Channel
```bash
# Get channel IDs
curl .../debug/discord/channels -H "..."

# Run on specific channel
curl -X POST .../debug/run -d '{"allowlist":["123456789"]}' -H "..."
```

### 4. Debug Gate Failures
```bash
# Why was this message skipped?
curl -X POST .../debug/eval-message \
  -d '{"channelId":"123","messageId":"456"}' -H "..."

# Test with synthetic content
curl -X POST .../debug/eval-message \
  -d '{"content":"!help","isBot":false}' -H "..."
# Will show: "Starts with command prefix (!, /, .)"
```

### 5. Test AI Naming
```bash
curl -X POST .../debug/generate-ai-name \
  -d '{"content":"Question about async/await","context":[{"content":"Previous discussion"}]}' \
  -H "..."
```

## Module Structure

```
backend/autothread/
├── index.ts      # Re-exports
├── types.ts      # Type definitions, config defaults
├── store.ts      # Database operations with namespace support
├── logic.ts      # Core processing logic (gates, AI, threading)
└── runner.ts     # High-level runner used by cron and debug
```

The cron job (`autothread.cron.ts`) and debug endpoint (`autothread-debug.http.ts`) both use the same underlying `runAutothread()` function, ensuring consistent behavior.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_TOKEN` | For debug | Bearer token for debug endpoints |
| `ENABLE_TEST_API` | For debug | Must be "true" to enable debug |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot authentication |
| `DISCORD_GUILD_ID` | Yes | Guild to monitor |
| `AUTOTHREAD_DRY_RUN` | No | Cron dry-run mode |
| `AUTOTHREAD_ENABLE_AI` | No | Enable AI naming in cron |
| `AUTOTHREAD_CHANNEL_ALLOWLIST` | No | Comma-separated channel IDs |
| `OPENAI_API_KEY` | For AI | OpenAI API key (Val Town std lib) |
