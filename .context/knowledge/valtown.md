# Val Town Knowledge Repository

> Living document for Val Town platform patterns, APIs, and best practices.  
> Last updated: 2026-01-29

## Platform Overview

Val Town is a serverless platform that runs TypeScript/JavaScript using the **Deno runtime**. Key characteristics:

- **No filesystem access** - Cannot read/write local files
- **No FFI** - Cannot call native code  
- **No subprocesses** - Cannot spawn child processes
- **Network access allowed** - HTTP requests permitted
- **Top-level await** - Supported natively
- **ES modules only** - No `require()`, must use `import/export`
- **Explicit file extensions** - Must include `.ts`, `.tsx`, `.js` in imports

## Val Types (Triggers)

### 1. HTTP Vals (`fileType: "http"`)
Handle HTTP requests. Files typically named `*.http.ts` or `*.http.tsx`.

```ts
export default async function(req: Request): Promise<Response> {
  return new Response("Hello World");
}
```

### 2. Interval/Cron Vals (`fileType: "interval"`)
Run on schedule. Files typically named `*.cron.ts`.

```ts
export default async function(interval: Interval) {
  console.log("Cron ran at", new Date());
}
```

**Scheduling limits:**
- Free plan: Every 15 minutes minimum
- Pro plan: Every 1 minute minimum
- Cron expressions evaluated in **UTC timezone**

**Internal polling pattern** (for near-real-time within 1-min cron):
```ts
export default async function() {
  const POLL_INTERVAL_MS = 5000;
  const RUN_DURATION_MS = 55000; // Leave 5s buffer
  const startTime = Date.now();
  
  while (Date.now() - startTime < RUN_DURATION_MS) {
    await pollAndProcess();
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}
```

### 3. Email Vals (`fileType: "email"`)
Triggered by incoming emails. Files typically named `*.email.ts`.

```ts
export default async function(email: Email) {
  console.log("Received email from:", email.from);
}
```

### 4. Script Vals (`fileType: "script"`)
General-purpose code, can export functions/values.

## Standard Library

### SQLite Storage

```ts
import { sqlite } from "https://esm.town/v/std/sqlite";

// Create table (idempotent)
await sqlite.execute(`
  CREATE TABLE IF NOT EXISTS my_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )
`);

// Query with parameters (ALWAYS use for user input!)
const result = await sqlite.execute({
  sql: `SELECT * FROM my_table WHERE id = ?`,
  args: [1]
});

// Result shape: { columns: string[], rows: any[][], rowsAffected: number, lastInsertRowid: bigint | null }

// Named parameters
await sqlite.execute({
  sql: `INSERT INTO my_table (name) VALUES (:name)`,
  args: { name: "value" }
});

// Batch queries (transactional)
await sqlite.batch([
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT, balance INTEGER)`,
  { sql: `UPDATE accounts SET balance = balance - :amount WHERE id = 'Bob'`, args: { amount: 10 } },
  { sql: `UPDATE accounts SET balance = balance + :amount WHERE id = 'Alice'`, args: { amount: 10 } }
]);
```

**Schema migration pattern:**
- Val Town has limited `ALTER TABLE` support
- Preferred: Create new table with `_2`, `_3` suffix, migrate data
- Or: Use dedicated migration val, version history acts as log

**Limits:**
- Free: 10MB storage
- Paid: Up to 1GB

### Blob Storage

```ts
import { blob } from "https://esm.town/v/std/blob";

await blob.setJSON("myKey", { hello: "world" });
const data = await blob.getJSON("myKey");
const keys = await blob.list("prefix_");
await blob.delete("myKey");
```

### OpenAI

```ts
import { OpenAI } from "https://esm.town/v/std/openai";

const openai = new OpenAI();
const completion = await openai.chat.completions.create({
  messages: [{ role: "user", content: "Hello" }],
  model: "gpt-4o-mini",
  max_tokens: 100
});
```

### Email

```ts
import { email } from "https://esm.town/v/std/email";

await email({
  subject: "Test",
  text: "Hello",
  html: "<h1>Hello</h1>"
});
```

## Project Utilities

```ts
import { 
  readFile, 
  serveFile, 
  listFiles, 
  parseProject 
} from "https://esm.town/v/std/utils@85-main/index.ts";

// Serve static files in Hono
app.get("/frontend/*", (c) => serveFile(c.req.path, import.meta.url));

// Read file content
const content = await readFile("/frontend/index.html", import.meta.url);

// List all project files
const files = await listFiles(import.meta.url);

// Get project metadata
const project = parseProject(import.meta.url);
// project.username, project.name, project.version, project.branch
// project.links.self.project (URL to project page)
```

**Important:** `parseProject` and utilities **only run on server**. Pass to client via HTML injection or API.

## Discord Bot Integration

### Bot Setup
1. Create app at [Discord Developer Portal](https://discord.com/developers/applications)
2. Get: Application ID, Public Key, Bot Token
3. Store as environment variables: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`

### API Patterns (Direct fetch, not SDK)

```ts
const DISCORD_API = "https://discord.com/api/v10";

async function discordRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bot ${Deno.env.get("DISCORD_BOT_TOKEN")}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  
  // Handle rate limits
  if (response.status === 429) {
    const data = await response.json();
    await new Promise(r => setTimeout(r, (data.retry_after ?? 1) * 1000));
    return discordRequest(path, init); // Retry
  }
  
  if (!response.ok) throw new Error(`Discord API error: ${response.status}`);
  return response.json();
}
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/guilds/{guild_id}/channels` | GET | List channels with topics |
| `/channels/{channel_id}/messages` | GET | Fetch messages (`?after=snowflake&limit=50`) |
| `/channels/{channel_id}/messages` | POST | Send message |
| `/channels/{channel_id}/messages/{message_id}/threads` | POST | Create thread from message |
| `/channels/{channel_id}/invites` | POST | Create invite |

### Slash Commands (Interactions Endpoint)

Val Town can't use WebSockets, so use HTTP Interactions:
1. Create HTTP val as interactions endpoint
2. Set URL in Discord Developer Portal → General Information → Interactions Endpoint URL
3. Handle signature verification

```ts
import { verifyDiscordRequest } from "https://esm.town/v/neverstew/verifyDiscordRequest";

export default async function(req: Request) {
  const isValid = await verifyDiscordRequest(req, Deno.env.get("discordPublicKey"));
  if (!isValid) return new Response("Invalid signature", { status: 401 });
  
  const body = await req.json();
  
  // Ping (Discord verification)
  if (body.type === 1) {
    return Response.json({ type: 1 });
  }
  
  // Slash command
  if (body.type === 2) {
    return Response.json({
      type: 4,
      data: { content: "Pong!" }
    });
  }
}
```

### Register Slash Commands

```ts
import { registerDiscordSlashCommand } from "https://esm.town/v/neverstew/registerDiscordSlashCommand";

await registerDiscordSlashCommand(
  Deno.env.get("discordAppId"),
  Deno.env.get("discordBotToken"),
  { name: "ping", description: "Say hi to your bot" }
);
```

## TypeScript SDK

For programmatic Val Town access:

```ts
import ValTown from "@valtown/sdk";

const client = new ValTown({ bearerToken: "..." });

// List vals
for await (const val of client.me.vals.list()) {
  console.log(val.name);
}

// Run val
const result = await client.vals.execute("username/valName");
```

## Best Practices

### Error Handling
```ts
app.onError((err, c) => {
  throw err; // Re-throw to see full stack traces
});
```

### Environment Variables
```ts
const token = Deno.env.get("MY_SECRET");
// Never bake secrets into code!
```

### Imports
- Use `https://esm.sh` for npm packages (works server + browser)
- Pin versions: `https://esm.sh/react@18.2.0`
- React deps must all pin same version: `?deps=react@18.2.0,react-dom@18.2.0`

### Redirects
```ts
// Response.redirect is broken in Val Town
return new Response(null, { 
  status: 302, 
  headers: { Location: "/new-path" } 
});
```

### Client-Side Error Debugging
```html
<script src="https://esm.town/v/std/catch"></script>
```

## Common Gotchas

1. **No `__dirname`/`__filename`** - Use `import.meta.url` instead
2. **No Deno KV** - Use SQLite or Blob storage
3. **No `alert()`/`prompt()`/`confirm()`** - Browser APIs not available
4. **Cold starts ~100ms+** - First request slower
5. **Shared code** - Files in `shared/` must work in both frontend and backend (no `Deno` keyword)

## Townie AI Assistant

Val Town's built-in AI (Townie) has full MCP access:
- List, search, create vals
- Read, write, run files
- Query SQLite/Blob storage
- Read logs and configure crons

System prompt available at: https://val.town/townie/system-prompt

## Development Tools

- **Val Town CLI (`vt`)**: Deploy from terminal, `vt tail` for logs, `vt watch` for auto-sync
- **valtown-watch**: Auto-sync local changes
- **LibSQL Studio**: Database viewer (recommended)

## Resources

- Docs: https://docs.val.town
- SDK Docs: https://sdk.val.town
- Discord: https://discord.val.town
- TypeScript SDK: `@valtown/sdk`
