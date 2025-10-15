# Talk Submission System

[github](https://github.com/colelawrence/rust-nyc-talk-submissions) | [val town](https://www.val.town/x/colel/rust-nyc-talk-submissions/code/backend/index.ts)

A complete talk submission system with Discord integration for event organizers.

## Features

- **Talk Submission Form**: Collects speaker name, talk context, and submission type
- **Discord Integration**: Automatically creates channels and sends notifications
- **Database Storage**: Tracks all submissions with SQLite
- **Responsive UI**: Clean, modern interface built with React and TailwindCSS

## How It Works

1. **Form Submission**: Users fill out the talk submission form
2. **Database Storage**: Submission is saved to SQLite database
3. **Discord Channel Creation**: A dedicated channel is created for the talk discussion
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

You'll need to set up the following environment variables for Discord integration:

- `DISCORD_BOT_TOKEN`: Your Discord bot token
- `DISCORD_GUILD_ID`: Your Discord server ID
- `DISCORD_ORGANIZERS_CHANNEL_ID`: Channel ID where organizer notifications are sent
- `DISCORD_CATEGORY_ID` (optional): Category ID for organizing talk channels
- `DISCORD_TEST_CATEGORY_ID` (optional): Category ID for organizing test channels
- `DISCORD_TEST_ORGANIZERS_CHANNEL_ID` (optional): Channel ID for test announcements

#### Testing Environment Variables

The following environment variables are used for testing the Discord integration without affecting production channels:

- `ENABLE_TEST_API`: Set to "true" to enable the test API endpoint (required for testing)
- `DISCORD_TEST_CATEGORY_ID`: Separate category for test channels to keep them organized
- `DISCORD_TEST_ORGANIZERS_CHANNEL_ID`: Separate channel for test notifications to avoid spamming production organizers

**Testing the Discord Integration:**

```bash
curl -X POST https://rustnyc-talks.val.run/api/discord/test \
  -H "Content-Type: application/json" \
  -d '{"channelName": "my-test-channel", "firstMessage": "Hello from test endpoint!"}'
```

**Parameters:**
- `channelName` (required): Name for the test channel (will be sanitized for Discord)
- `firstMessage` (required): First message to send to the channel

This will create a test channel with the specified name, send the first message, and return an invite link. If test environment variables are configured, it will also notify the test organizers channel.

**Testing Discord Invite Creation Directly:**

You can also test the Discord invite creation process directly using Discord's API:

```bash
curl -X POST https://discord.com/api/v10/channels/CHANNEL_ID/invites \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "max_age": 0,
    "max_uses": 0,
    "unique": true
  }'
```

Replace `CHANNEL_ID` with an existing channel ID and `YOUR_BOT_TOKEN` with your Discord bot token. This matches exactly how the bot creates invitation links internally.

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
CREATE TABLE talk_submissions_1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  speaker_name TEXT NOT NULL,
  talk_context TEXT NOT NULL,
  is_on_behalf BOOLEAN NOT NULL,
  discord_channel_id TEXT,
  discord_invite_link TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

- `POST /api/submissions` - Submit a new talk proposal
- `GET /api/submissions` - Get all submissions (admin)
- `POST /api/discord/test` - Test Discord integration (creates test channel and sends message)

## Discord Integration Status

✅ **Discord integration is fully implemented with comprehensive logging**

The system will automatically:
- Create Discord channels for each talk submission
- Generate invite links for the channels  
- Post notifications to the organizers channel

**Comprehensive Logging**: The system includes detailed logging throughout the Discord integration process:
- 🔍 Environment variable checks on startup
- 🎯 API request tracking with submission details
- 🔧 Discord channel creation with API responses
- 🔗 Invite link generation with full details
- 📢 Organizer notifications with message content
- 💥 Detailed error logging with stack traces and specific Discord error codes
- 📊 Final result summaries

**Fallback behavior**: If Discord credentials are not provided, the system will use placeholder values and log what would have been done, allowing the form to still function for testing.

**Debugging**: Use the requests tool to view detailed logs of each submission, including all Discord API interactions and any errors that occur.

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