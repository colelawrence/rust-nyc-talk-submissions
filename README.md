# Talk Submission System

[github](https://github.com/colelawrence/rust-nyc-talk-submissions) |
[val town](https://www.val.town/x/colel/rust-nyc-talk-submissions/code/backend/index.ts)

A complete talk submission system with Discord integration for event organizers.

## Features

- **Talk Submission Form**: Collects speaker name, talk context, and submission
  type
- **Discord Integration**: Automatically creates channels and sends
  notifications
- **Database Storage**: Tracks all submissions with SQLite
- **Responsive UI**: Clean, modern interface built with React and TailwindCSS

## How It Works

1. **Form Submission**: Users fill out the talk submission form
2. **Database Storage**: Submission is saved to SQLite database
3. **Discord Channel Creation**: A dedicated channel is created for the talk
   discussion
4. **Organizer Notification**: A message is posted to the organizers' channel
5. **Invite Link**: User receives a Discord invite link to join the discussion

## Project Structure

```
├── backend/
│   └── index.ts              # Main API server with Hono
├── frontend/
│   ├── index.html           # Main HTML template
│   ├── index.tsx            # React app entry point
│   └── components/
│       ├── App.tsx          # Main app component
│       ├── TalkSubmissionForm.tsx  # Form component
│       └── SubmissionSuccess.tsx   # Success page component
├── shared/
│   └── types.ts             # Shared TypeScript types
└── README.md
```

## Setup

### Environment Variables

#### Discord integration

- `DISCORD_BOT_TOKEN`: Your Discord bot token
- `DISCORD_GUILD_ID`: Your Discord server ID
- `DISCORD_ORGANIZERS_CHANNEL_ID`: Channel ID where organizer notifications are sent
- `DISCORD_CATEGORY_ID` (optional): Category ID for organizing talk channels
- `DISCORD_INVITE_MAX_AGE_SECONDS` (optional): Invite expiration in seconds.
  - Default: `604800` (7 days)
  - Set to `0` for never expires
  - Valid: `0` or `1..604800`

#### Admin/auth (required for admin/test endpoints)

- `ADMIN_TOKEN`: Required for:
  - `GET /api/submissions`
  - `POST /api/discord/test`
  - `/api/autothread/debug/*`

  Use a cryptographically-random token (>=32 chars), e.g.:

  ```bash
  openssl rand -hex 32
  ```

  Send as: `Authorization: Bearer $ADMIN_TOKEN`

#### Rate limiting (abuse control)

- `RATE_LIMIT_ENABLED` (optional): Default `true`. Set to `false` to disable.
- `RATE_LIMIT_WINDOW_SECONDS` (optional): Default `900` (15 minutes).
- `RATE_LIMIT_MAX` (optional): Default `10` requests per window.

#### Retention (cron cleanup)

- `AUTOTHREAD_LOG_RETENTION_DAYS` (optional): Default `30`. Set to `0` to disable.
- `RATE_LIMIT_RETENTION_DAYS` (optional): Default `30`. Set to `0` to disable.

#### Testing Environment Variables

These variables are used for testing/debugging without affecting production channels:

- `ENABLE_TEST_API`: Set to "true" to enable debug/test endpoints.
- `DISCORD_TEST_CATEGORY_ID` (optional): Category ID for organizing test channels.
- `DISCORD_TEST_ORGANIZERS_CHANNEL_ID` (optional): Channel ID for test announcements.

**Testing via the talk submission form:**

If the speaker name contains a test marker matching `/\W\s*test\s*\W/i` (e.g. `Jane Doe (test)`), the submission will be routed to the test category + test organizers channel **instead of production**.

- Requires `ENABLE_TEST_API=true`
- Requires both `DISCORD_TEST_CATEGORY_ID` and `DISCORD_TEST_ORGANIZERS_CHANNEL_ID`
- If test mode isn't enabled/configured, the submission will be rejected (no DB write / no Discord side effects)

**Testing the Discord Integration (`POST /api/discord/test`):**

Requires both `ENABLE_TEST_API=true` and `ADMIN_TOKEN`.

```bash
curl -X POST https://rustnyc-talks.val.run/api/discord/test \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channelName": "my-test-channel", "firstMessage": "Hello from test endpoint!"}'
```

**Parameters:**

- `channelName` (required): Name for the test channel (will be sanitized for Discord)
- `firstMessage` (required): First message to send to the channel

This will create a test channel, send the first message, and return an invite link.

**Testing Discord Invite Creation Directly (Discord API):**

```bash
curl -X POST https://discord.com/api/v10/channels/CHANNEL_ID/invites \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "max_age": 604800,
    "max_uses": 0,
    "unique": true
  }'
```

Use `max_age: 0` for never-expiring invites.

### Discord Bot Setup

1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot and copy the token
3. Invite the bot to your server with the following permissions:
   - Manage Channels
   - Send Messages
   - Create Instant Invite
   - View Channels

### Database

The system uses SQLite with the following schema:

```sql
CREATE TABLE talk_submissions_3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  speaker_name TEXT NOT NULL,
  talk_context TEXT NOT NULL,
  is_on_behalf BOOLEAN NOT NULL,
  submitter_name TEXT,
  discord_channel_id TEXT,
  discord_invite_link TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

- `POST /api/submissions` — Submit a new talk proposal.
  - Rate limited when enabled (HTTP 429 + `Retry-After` header)
- `GET /api/submissions?limit=50&offset=0` — List submissions (admin-only).
  - Requires `Authorization: Bearer $ADMIN_TOKEN`
  - Returns `{ data, total, limit, offset }`
- `POST /api/discord/test` — Test Discord integration (creates a test channel and sends a message).
  - Requires `ENABLE_TEST_API=true`
  - Requires `Authorization: Bearer $ADMIN_TOKEN`

## Discord Integration Status

✅ **Discord integration is fully implemented with comprehensive logging**

The system will automatically:

- Create Discord channels for each talk submission
- Generate invite links for the channels
- Post notifications to the organizers channel

**Comprehensive Logging**: The system includes detailed logging throughout the
Discord integration process:

- 🔍 Environment variable checks on startup
- 🎯 API request tracking with submission details
- 🔧 Discord channel creation with API responses
- 🔗 Invite link generation (invite code redacted in logs)
- 📢 Organizer notifications with message content
- 💥 Detailed error logging with stack traces and specific Discord error codes
- 📊 Final result summaries

**Fallback behavior**: If Discord credentials are not provided, the system will
use placeholder values and log what would have been done, allowing the form to
still function for testing.

**Debugging**: Use the requests tool to view detailed logs of each submission,
including all Discord API interactions and any errors that occur.

## Usage

1. Fill out the talk submission form
2. Submit the form
3. Receive a Discord invite link
4. Join the Discord channel to discuss your talk with organizers

## Tech Stack

- **Backend**: Hono (API framework)
- **Frontend**: React 18.2.0 with TypeScript
- **Database**: SQLite
- **Styling**: TailwindCSS
- **Platform**: Val Town (Deno runtime)
