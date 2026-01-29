import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  readFile,
  serveFile,
} from "https://esm.town/v/std/utils@85-main/index.ts";
import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";
import { loadEnv } from "./config.ts";
import { makeDiscordService } from "./discord.ts";
import { safe } from "./errors.ts";
import {
  organizersNotification,
  sanitizeChannelName,
  testMessage,
  testNotification,
  welcomeMessage,
} from "./messages.ts";

const app = new Hono();

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

  const body = await c.req.json();
  const { speakerName, talkContext, isOnBehalf, submitterName } = body;

  console.log(`📋 [API] Submission details:`);
  console.log(`  Speaker: "${speakerName}"`);
  console.log(`  Context length: ${talkContext?.length || 0} characters`);
  console.log(`  On behalf: ${isOnBehalf}`);
  if (isOnBehalf && submitterName) {
    console.log(`  Submitter: "${submitterName}"`);
  }

  if (!speakerName || !talkContext || typeof isOnBehalf !== "boolean") {
    console.error(`❌ [API] Validation failed - missing required fields`);
    return c.json({ error: "Missing required fields" }, 400);
  }

  if (isOnBehalf && !submitterName?.trim()) {
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

  const channelName = `nodate-${submissionId}-${
    sanitizeChannelName(speakerName)
  }`;
  const channelId = await discord.createChannel(
    channelName,
    config.discord?.categoryId,
  );

  const inviteLink = await discord.createInvite(channelId);

  await safe(
    "welcome",
    discord.sendMessage(
      channelId,
      welcomeMessage({ speakerName, talkContext, isOnBehalf, submitterName }),
    ),
    { swallow: true },
  );

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

app.get("/api/submissions", async (c) => {
  const submissions = await sqlite.execute(
    `SELECT * FROM ${TABLE_NAME} ORDER BY created_at DESC`,
  );
  return c.json(submissions);
});

app.post("/api/discord/test", async (c) => {
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
