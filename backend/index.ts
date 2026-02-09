import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  readFile,
  serveFile,
} from "https://esm.town/v/std/utils@85-main/index.ts";
import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";
import { loadEnv } from "./config.ts";
import { requireAdmin } from "./auth.ts";
import { makeDiscordService } from "./discord.ts";
import { safe } from "./errors.ts";
import {
  organizersNotification,
  sanitizeChannelName,
  talkContextMessages,
  testMessage,
  testNotification,
  welcomeMessage,
} from "./messages.ts";
import autothreadDebug from "./autothread-debug.http.ts";

const app = new Hono();

// Mount autothread debug console
app.route("/api/autothread/debug", autothreadDebug);

app.onError((err, _c) => {
  throw err;
});

const TABLE_NAME = "talk_submissions_3";

async function initDatabase() {
  console.log(`💾 [DB] Initializing database table: ${TABLE_NAME}`);
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    speaker_name TEXT NOT NULL,
    talk_context TEXT NOT NULL,
    is_on_behalf BOOLEAN NOT NULL,
    submitter_name TEXT,
    discord_channel_id TEXT,
    discord_invite_link TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log(`✅ [DB] Database initialization complete`);
}

await initDatabase();

const config = loadEnv();
const discord = makeDiscordService(config.discord);

console.log(
  `🚀 [System] Talk submission system ready! Discord: ${
    config.discord ? "Enabled" : "Placeholder mode"
  }`,
);

app.get("/frontend/*", (c) => serveFile(c.req.path, import.meta.url));
app.get("/shared/*", (c) => serveFile(c.req.path, import.meta.url));

app.get("/", async (c) => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

app.post("/api/submissions", async (c) => {
  console.log(`🎯 [API] New talk submission received`);

  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    console.error(`❌ [API] Invalid JSON body`);
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const speakerName =
    typeof (body as any).speakerName === "string"
      ? (body as any).speakerName.trim()
      : "";
  const talkContext =
    typeof (body as any).talkContext === "string"
      ? (body as any).talkContext.trim()
      : "";
  const isOnBehalfRaw = (body as any).isOnBehalf;
  const submitterName =
    typeof (body as any).submitterName === "string"
      ? (body as any).submitterName.trim()
      : "";

  console.log(`📋 [API] Submission details:`);
  console.log(`  Speaker: "${speakerName}"`);
  console.log(`  Context length: ${talkContext.length} characters`);
  console.log(`  On behalf: ${isOnBehalfRaw}`);
  if (isOnBehalfRaw === true && submitterName) {
    console.log(`  Submitter: "${submitterName}"`);
  }

  if (!speakerName || !talkContext || typeof isOnBehalfRaw !== "boolean") {
    console.error(`❌ [API] Validation failed - missing required fields`);
    return c.json({ error: "Missing required fields" }, 400);
  }

  const isOnBehalf = isOnBehalfRaw;

  const MAX_NAME_CHARS = 120;
  const MAX_CONTEXT_CHARS = 8000;

  if (speakerName.length > MAX_NAME_CHARS) {
    return c.json(
      { error: `Speaker name is too long (max ${MAX_NAME_CHARS} characters)` },
      400,
    );
  }

  if (submitterName.length > MAX_NAME_CHARS) {
    return c.json(
      {
        error:
          `Submitter name is too long (max ${MAX_NAME_CHARS} characters)`,
      },
      400,
    );
  }

  if (talkContext.length > MAX_CONTEXT_CHARS) {
    return c.json(
      { error: `Talk context is too long (max ${MAX_CONTEXT_CHARS} characters)` },
      400,
    );
  }

  if (isOnBehalf && !submitterName) {
    console.error(
      `❌ [API] Validation failed - submitter name required when submitting on behalf`,
    );
    return c.json({
      error:
        "Submitter name is required when submitting on behalf of someone else",
    }, 400);
  }

  console.log(`💾 [API] Inserting submission into database`);

  const result = await sqlite.execute(
    `INSERT INTO ${TABLE_NAME} (speaker_name, talk_context, is_on_behalf, submitter_name) VALUES (?, ?, ?, ?)`,
    [speakerName, talkContext, isOnBehalf, isOnBehalf ? submitterName : null],
  );

  const submissionId = Number(result.lastInsertRowid);
  console.log(
    `✅ [API] Database insertion successful, submission ID: ${submissionId}`,
  );

  console.log(`🤖 [API] Starting Discord integration workflow`);

  const channelName = sanitizeChannelName(`nodate-${submissionId}-${speakerName}`);
  const channelId = await discord.createChannel(
    channelName,
    config.discord?.categoryId,
  );

  const inviteLink = await discord.createInvite(channelId);

  await safe(
    "welcome",
    discord.sendMessage(
      channelId,
      welcomeMessage({ speakerName, isOnBehalf, submitterName }),
    ),
    { swallow: true },
  );

  for (const msg of talkContextMessages(talkContext)) {
    await safe(
      "talk-context",
      discord.sendMessage(channelId, msg),
      { swallow: true },
    );
  }

  if (config.discord?.organizersChannelId) {
    await safe(
      "organizers",
      discord.sendMessage(
        config.discord.organizersChannelId,
        organizersNotification({
          speakerName,
          talkContext,
          isOnBehalf,
          submitterName,
          channelId,
        }),
      ),
      { swallow: true },
    );
  }

  console.log(`💾 [API] Updating database with Discord information`);

  await sqlite.execute(
    `UPDATE ${TABLE_NAME} SET discord_channel_id = ?, discord_invite_link = ? WHERE id = ?`,
    [channelId, inviteLink, submissionId],
  );

  console.log(`✅ [API] Submission processing complete!`);
  console.log(`📊 [API] Final result:`);
  console.log(`  Submission ID: ${submissionId}`);
  console.log(`  Discord Channel ID: ${channelId}`);
  console.log(`  Discord Invite: ${inviteLink}`);

  return c.json({
    success: true,
    submissionId,
    discordInviteLink: inviteLink,
  });
});

app.get("/api/submissions", requireAdmin, async (c) => {
  const submissions = await sqlite.execute(
    `SELECT * FROM ${TABLE_NAME} ORDER BY created_at DESC`,
  );
  return c.json(submissions.rows);
});

app.get("/api/autothread/health", async (c) => {
  const { AutothreadStore } = await import("./autothread/index.ts");
  const store = new AutothreadStore("prod");

  try {
    await store.initTables();

    const lastRun = await store.getLastRun();
    const state = await store.getState();

    return c.json({
      status: lastRun ? "ok" : "no_runs",
      lastRun,
      today: new Date().toISOString().slice(0, 10),
      ...state,
    });
  } catch (err) {
    return c.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

app.post("/api/discord/test", requireAdmin, async (c) => {
  console.log(`🧪 [Test] Discord test endpoint called`);

  if (!config.enableTestApi) {
    console.warn(
      `⚠️ [Test] Test API is disabled. Set ENABLE_TEST_API=true to enable.`,
    );
    return c.json({ error: "Test API is disabled" }, 403);
  }

  const body = await c.req.json();
  const { channelName, firstMessage } = body;

  if (!channelName || !firstMessage) {
    return c.json(
      { error: "channelName and firstMessage are required" },
      400,
    );
  }

  const sanitizedChannelName = sanitizeChannelName(channelName);

  console.log(`🧪 [Test] Creating test channel: ${sanitizedChannelName}`);
  const channelId = await discord.createChannel(
    sanitizedChannelName,
    config.discord?.testCategoryId,
  );

  console.log(`🧪 [Test] Sending test message to channel: ${channelId}`);
  await discord.sendMessage(channelId, testMessage(firstMessage));

  console.log(`🧪 [Test] Creating invite for test channel`);
  const inviteLink = await discord.createInvite(channelId);

  if (config.discord?.testOrganizersChannelId) {
    console.log(`🧪 [Test] Notifying test organizers`);
    await safe(
      "test-organizers",
      discord.sendMessage(
        config.discord.testOrganizersChannelId,
        testNotification({
          channelName: sanitizedChannelName,
          firstMessage,
          channelId,
          inviteLink,
        }),
      ),
      { swallow: true },
    );
  }

  return c.json({
    success: true,
    channelId,
    channelName: sanitizedChannelName,
    inviteLink,
    message: "Test completed successfully!",
  });
});

export default app.fetch;
