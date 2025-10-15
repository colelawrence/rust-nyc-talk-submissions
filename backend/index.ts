import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  readFile,
  serveFile,
} from "https://esm.town/v/std/utils@85-main/index.ts";
import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";

const app = new Hono();

// Unwrap Hono errors to see original error details
app.onError((err, c) => {
  throw err;
});

// Database setup
const TABLE_NAME = "talk_submissions_3"; // Updated table name for new schema with submitter_name

// Initialize database
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

// Check Discord environment on startup
function checkDiscordEnvironment() {
  console.log(`🔍 [Discord] Checking environment configuration...`);

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const guildId = Deno.env.get("DISCORD_GUILD_ID");
  const organizersChannelId = Deno.env.get("DISCORD_ORGANIZERS_CHANNEL_ID");
  const categoryId = Deno.env.get("DISCORD_CATEGORY_ID");
  const testCategoryId = Deno.env.get("DISCORD_TEST_CATEGORY_ID");
  const testOrganizersChannelId = Deno.env.get(
    "DISCORD_TEST_ORGANIZERS_CHANNEL_ID",
  );
  const testApiEnabled = Deno.env.get("ENABLE_TEST_API");

  console.log(
    `🤖 [Discord] Bot Token: ${botToken ? "✅ Present" : "❌ Missing"}`,
  );
  console.log(
    `🏠 [Discord] Guild ID: ${guildId ? "✅ Present" : "❌ Missing"}`,
  );
  console.log(
    `📢 [Discord] Organizers Channel: ${
      organizersChannelId ? "✅ Present" : "❌ Missing"
    }`,
  );
  console.log(
    `📁 [Discord] Category ID: ${
      categoryId ? "✅ Present" : "⚪ Optional (not set)"
    }`,
  );
  console.log(
    `🧪 [Discord] Test Category ID: ${
      testCategoryId ? "✅ Present" : "⚪ Optional (not set)"
    }`,
  );
  console.log(
    `🧪 [Discord] Test Organizers Channel: ${
      testOrganizersChannelId ? "✅ Present" : "⚪ Optional (not set)"
    }`,
  );
  console.log(
    `🧪 [Discord] Test API Enabled: ${
      testApiEnabled?.toLowerCase() === "true" ? "✅ Enabled" : "⚪ Disabled"
    }`,
  );

  const isFullyConfigured = botToken && guildId && organizersChannelId;

  if (isFullyConfigured) {
    console.log(`✅ [Discord] Full Discord integration enabled`);
  } else {
    console.log(`⚠️ [Discord] Discord integration will use placeholder mode`);
    console.log(
      `ℹ️ [Discord] To enable full integration, set: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_ORGANIZERS_CHANNEL_ID`,
    );
  }

  return isFullyConfigured;
}

// Initialize DB and check environment on startup
await initDatabase();
const discordConfigured = checkDiscordEnvironment();
console.log(
  `🚀 [System] Talk submission system ready! Discord: ${
    discordConfigured ? "Enabled" : "Placeholder mode"
  }`,
);

// Serve static files
app.get("/frontend/*", (c) => serveFile(c.req.path, import.meta.url));
app.get("/shared/*", (c) => serveFile(c.req.path, import.meta.url));

// Serve main page
app.get("/", async (c) => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

// API Routes
app.post("/api/submissions", async (c) => {
  console.log(`🎯 [API] New talk submission received`);

  try {
    const body = await c.req.json();
    const { speakerName, talkContext, isOnBehalf, submitterName } = body;

    console.log(`📋 [API] Submission details:`);
    console.log(`  Speaker: "${speakerName}"`);
    console.log(`  Context length: ${talkContext?.length || 0} characters`);
    console.log(`  On behalf: ${isOnBehalf}`);
    if (isOnBehalf && submitterName) {
      console.log(`  Submitter: "${submitterName}"`);
    }

    // Validate input
    if (!speakerName || !talkContext || typeof isOnBehalf !== "boolean") {
      console.error(`❌ [API] Validation failed - missing required fields`);
      console.error(`  speakerName: ${!!speakerName}`);
      console.error(`  talkContext: ${!!talkContext}`);
      console.error(`  isOnBehalf: ${typeof isOnBehalf}`);
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Validate submitter name if submitting on behalf
    if (isOnBehalf && !submitterName?.trim()) {
      console.error(
        `❌ [API] Validation failed - submitter name required when submitting on behalf`,
      );
      return c.json(
        {
          error:
            "Submitter name is required when submitting on behalf of someone else",
        },
        400,
      );
    }

    console.log(`💾 [API] Inserting submission into database`);

    // Insert submission into database
    const result = await sqlite.execute(
      `INSERT INTO ${TABLE_NAME} (speaker_name, talk_context, is_on_behalf, submitter_name) VALUES (?, ?, ?, ?)`,
      [speakerName, talkContext, isOnBehalf, isOnBehalf ? submitterName : null],
    );

    const submissionId = Number(result.lastInsertRowid);
    console.log(
      `✅ [API] Database insertion successful, submission ID: ${submissionId}`,
    );

    // Discord integration workflow
    console.log(`🤖 [API] Starting Discord integration workflow`);

    console.log(`🔧 [API] Step 1: Creating Discord channel`);
    const discordChannelId = await createDiscordChannel(
      speakerName,
      submissionId,
    );

    console.log(`🔗 [API] Step 2: Creating Discord invite`);
    const discordInviteLink = await createDiscordInvite(discordChannelId);

    console.log(`💬 [API] Step 3: Sending welcome message to channel`);
    await sendWelcomeMessage(
      discordChannelId,
      speakerName,
      talkContext,
      isOnBehalf,
      submitterName,
    );

    console.log(`📢 [API] Step 4: Notifying organizers`);
    await postToOrganizersChannel(
      speakerName,
      talkContext,
      isOnBehalf,
      submitterName,
      discordChannelId,
    );

    console.log(`💾 [API] Updating database with Discord information`);

    // Update submission with Discord info
    await sqlite.execute(
      `UPDATE ${TABLE_NAME} SET discord_channel_id = ?, discord_invite_link = ? WHERE id = ?`,
      [discordChannelId, discordInviteLink, submissionId],
    );

    console.log(`✅ [API] Submission processing complete!`);
    console.log(`📊 [API] Final result:`);
    console.log(`  Submission ID: ${submissionId}`);
    console.log(`  Discord Channel ID: ${discordChannelId}`);
    console.log(`  Discord Invite: ${discordInviteLink}`);

    return c.json({
      success: true,
      submissionId: submissionId,
      discordInviteLink,
    });
  } catch (error) {
    console.error(`💥 [API] Critical error processing submission:`, error);
    console.error(`💥 [API] Error type:`, error.constructor.name);
    console.error(`💥 [API] Error message:`, error.message);
    if (error.stack) {
      console.error(`💥 [API] Stack trace:`, error.stack);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get all submissions (for admin view)
app.get("/api/submissions", async (c) => {
  try {
    const submissions = await sqlite.execute(
      `SELECT * FROM ${TABLE_NAME} ORDER BY created_at DESC`,
    );
    return c.json(submissions);
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Test Discord functionality
app.post("/api/discord/test", async (c) => {
  console.log(`🧪 [Test] Discord test endpoint called`);

  // Check if test API is enabled
  const testApiEnabled = Deno.env.get("ENABLE_TEST_API");
  if (!testApiEnabled || testApiEnabled.toLowerCase() !== "true") {
    console.warn(
      `⚠️ [Test] Test API is disabled. Set ENABLE_TEST_API=true to enable.`,
    );
    return c.json({ error: "Test API is disabled" }, 403);
  }

  try {
    const body = await c.req.json();
    const { channelName, firstMessage } = body;

    if (!channelName || !firstMessage) {
      return c.json(
        { error: "channelName and firstMessage are required" },
        400,
      );
    }

    const sanitizedChannelName = channelName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-");
    const message = firstMessage;

    console.log(`🧪 [Test] Creating test channel: ${sanitizedChannelName}`);
    const channelId = await createDiscordTestChannel(sanitizedChannelName);

    console.log(`🧪 [Test] Sending test message to channel: ${channelId}`);
    await sendTestMessage(channelId, message);

    console.log(`🧪 [Test] Creating invite for test channel`);
    const inviteLink = await createDiscordInvite(channelId);

    console.log(`🧪 [Test] Notifying test organizers`);
    await notifyTestOrganizers(
      sanitizedChannelName,
      message,
      channelId,
      inviteLink,
    );

    return c.json({
      success: true,
      channelId,
      channelName: sanitizedChannelName,
      inviteLink,
      message: "Test completed successfully!",
    });
  } catch (error) {
    console.error(`💥 [Test] Error in Discord test:`, error);
    return c.json({ error: error.message }, 500);
  }
});

// Discord integration functions
async function createDiscordChannel(
  speakerName: string,
  submissionId: number,
): Promise<string> {
  console.log(
    `🔧 [Discord] Starting channel creation for speaker: "${speakerName}", submission ID: ${submissionId}`,
  );

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const guildId = Deno.env.get("DISCORD_GUILD_ID");
  const categoryId = Deno.env.get("DISCORD_CATEGORY_ID");

  // Check environment variables
  if (!botToken) {
    console.warn(
      `⚠️ [Discord] DISCORD_BOT_TOKEN not found in environment variables`,
    );
  }
  if (!guildId) {
    console.warn(
      `⚠️ [Discord] DISCORD_GUILD_ID not found in environment variables`,
    );
  }
  if (categoryId) {
    console.log(`📁 [Discord] Using category ID: ${categoryId}`);
  } else {
    console.log(
      `📁 [Discord] No category ID specified, channel will be created at root level`,
    );
  }

  if (!botToken || !guildId) {
    console.log(
      `🔄 [Discord] Missing credentials, using placeholder for ${speakerName} (submission ${submissionId})`,
    );
    return `channel_${submissionId}_placeholder`;
  }

  try {
    const channelName = `nodate-${submissionId}-${
      speakerName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
    }`;
    console.log(`📝 [Discord] Generated channel name: "${channelName}"`);

    const channelData: any = {
      name: channelName,
      type: 0, // Text channel
      topic:
        `Discussion for ${speakerName}'s talk proposal (Submission #${submissionId})`,
    };

    if (categoryId) {
      channelData.parent_id = categoryId;
    }

    console.log(
      `🚀 [Discord] Making API request to create channel in guild ${guildId}`,
    );
    console.log(
      `📊 [Discord] Channel data:`,
      JSON.stringify(channelData, null, 2),
    );

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(channelData),
      },
    );

    console.log(
      `📡 [Discord] API Response Status: ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [Discord] Channel creation failed with status ${response.status}`,
      );
      console.error(`❌ [Discord] Error response body:`, errorText);

      try {
        const errorJson = JSON.parse(errorText);
        console.error(
          `❌ [Discord] Parsed error:`,
          JSON.stringify(errorJson, null, 2),
        );
      } catch {
        console.error(`❌ [Discord] Could not parse error response as JSON`);
      }

      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const channel = await response.json();
    console.log(`✅ [Discord] Channel created successfully!`);
    console.log(`📋 [Discord] Channel ID: ${channel.id}`);
    console.log(`📋 [Discord] Channel Name: ${channel.name}`);

    return channel.id;
  } catch (error) {
    console.error(`💥 [Discord] Exception during channel creation:`, error);
    console.error(`💥 [Discord] Error type:`, error.constructor.name);
    console.error(`💥 [Discord] Error message:`, error.message);
    if (error.stack) {
      console.error(`💥 [Discord] Stack trace:`, error.stack);
    }
    return `channel_${submissionId}_placeholder`;
  }
}

async function createDiscordInvite(channelId: string): Promise<string> {
  console.log(
    `🔗 [Discord] Starting invite creation for channel: ${channelId}`,
  );

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");

  if (!botToken) {
    console.warn(
      `⚠️ [Discord] DISCORD_BOT_TOKEN not found for invite creation`,
    );
  }

  if (!botToken || channelId.includes("placeholder")) {
    const placeholderInvite = `https://discord.gg/placeholder_${channelId}`;
    console.log(`🔄 [Discord] Using placeholder invite: ${placeholderInvite}`);
    return placeholderInvite;
  }

  try {
    const inviteData = {
      max_age: 0, // Never expires
      max_uses: 0, // Unlimited uses
      unique: true,
    };

    console.log(
      `🚀 [Discord] Making API request to create invite for channel ${channelId}`,
    );
    console.log(
      `📊 [Discord] Invite data:`,
      JSON.stringify(inviteData, null, 2),
    );

    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/invites`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(inviteData),
      },
    );

    console.log(
      `📡 [Discord] Invite API Response Status: ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [Discord] Invite creation failed with status ${response.status}`,
      );
      console.error(`❌ [Discord] Error response body:`, errorText);

      try {
        const errorJson = JSON.parse(errorText);
        console.error(
          `❌ [Discord] Parsed invite error:`,
          JSON.stringify(errorJson, null, 2),
        );
      } catch {
        console.error(
          `❌ [Discord] Could not parse invite error response as JSON`,
        );
      }

      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const invite = await response.json();
    const inviteUrl = `https://discord.gg/${invite.code}`;

    console.log(`✅ [Discord] Invite created successfully!`);
    console.log(`🔗 [Discord] Invite code: ${invite.code}`);
    console.log(`🔗 [Discord] Full invite URL: ${inviteUrl}`);
    console.log(
      `⏰ [Discord] Invite expires: ${
        invite.max_age === 0 ? "Never" : `${invite.max_age} seconds`
      }`,
    );
    console.log(
      `👥 [Discord] Max uses: ${
        invite.max_uses === 0 ? "Unlimited" : invite.max_uses
      }`,
    );

    return inviteUrl;
  } catch (error) {
    console.error(`💥 [Discord] Exception during invite creation:`, error);
    console.error(`💥 [Discord] Error type:`, error.constructor.name);
    console.error(`💥 [Discord] Error message:`, error.message);
    if (error.stack) {
      console.error(`💥 [Discord] Stack trace:`, error.stack);
    }

    const fallbackInvite = `https://discord.gg/placeholder_${channelId}`;
    console.log(
      `🔄 [Discord] Falling back to placeholder invite: ${fallbackInvite}`,
    );
    return fallbackInvite;
  }
}

async function createDiscordTestChannel(channelName: string): Promise<string> {
  console.log(`🧪 [Test] Creating test channel: ${channelName}`);

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const guildId = Deno.env.get("DISCORD_GUILD_ID");
  const testCategoryId = Deno.env.get("DISCORD_TEST_CATEGORY_ID");

  if (!botToken || !guildId) {
    console.log(`🔄 [Test] Missing credentials, using placeholder`);
    return `test_channel_placeholder_${Date.now()}`;
  }

  try {
    const channelData: any = {
      name: channelName,
      type: 0, // Text channel
      topic: `Test channel created at ${new Date().toISOString()}`,
    };

    if (testCategoryId) {
      channelData.parent_id = testCategoryId;
      console.log(`📁 [Test] Using test category ID: ${testCategoryId}`);
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(channelData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [Test] Channel creation failed: ${response.status} - ${errorText}`,
      );
      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const channel = await response.json();
    console.log(`✅ [Test] Test channel created: ${channel.id}`);
    return channel.id;
  } catch (error) {
    console.error(`💥 [Test] Error creating test channel:`, error);
    throw error;
  }
}

async function sendTestMessage(
  channelId: string,
  message: string,
): Promise<void> {
  console.log(`🧪 [Test] Sending message to channel: ${channelId}`);

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");

  if (!botToken || channelId.includes("placeholder")) {
    console.log(`🔄 [Test] Using placeholder mode, would send: ${message}`);
    return;
  }

  try {
    const messageData = {
      content: `🧪 **Test Message**\n${message}\n\n*Sent at ${
        new Date().toISOString()
      }*`,
    };

    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [Test] Message sending failed: ${response.status} - ${errorText}`,
      );
      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const messageResponse = await response.json();
    console.log(`✅ [Test] Message sent successfully: ${messageResponse.id}`);
  } catch (error) {
    console.error(`💥 [Test] Error sending test message:`, error);
    throw error;
  }
}

async function notifyTestOrganizers(
  channelName: string,
  firstMessage: string,
  channelId: string,
  inviteLink: string,
): Promise<void> {
  console.log(
    `🧪 [Test] Starting test organizer notification for channel: "${channelName}"`,
  );

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const testOrganizersChannelId = Deno.env.get(
    "DISCORD_TEST_ORGANIZERS_CHANNEL_ID",
  );

  if (!botToken) {
    console.warn(
      `⚠️ [Test] DISCORD_BOT_TOKEN not found for test organizer notification`,
    );
  }
  if (!testOrganizersChannelId) {
    console.warn(
      `⚠️ [Test] DISCORD_TEST_ORGANIZERS_CHANNEL_ID not found, skipping notification`,
    );
    return;
  }

  const message = `🧪 **Test Channel Created**
**Channel Name:** ${channelName}
**First Message:** ${firstMessage}
**Channel Link:** ${
    channelId.includes("placeholder")
      ? "Channel creation failed"
      : `<#${channelId}>`
  }
**Invitation Link:** ${inviteLink}`;

  console.log(`📝 [Test] Prepared test organizer message:`);
  console.log(message);

  if (!botToken) {
    console.log(`🔄 [Test] Missing bot token, would have posted above message`);
    return;
  }

  try {
    const messageData = {
      content: message,
    };

    console.log(
      `🚀 [Test] Making API request to post to test organizers channel ${testOrganizersChannelId}`,
    );

    const response = await fetch(
      `https://discord.com/api/v10/channels/${testOrganizersChannelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [Test] Test organizer notification failed: ${response.status} - ${errorText}`,
      );
      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const messageResponse = await response.json();
    console.log(
      `✅ [Test] Test organizer notification sent successfully: ${messageResponse.id}`,
    );
  } catch (error) {
    console.error(
      `💥 [Test] Error sending test organizer notification:`,
      error,
    );
    // Don't throw here - we don't want to fail the test if notification fails
    console.log(
      `🔄 [Test] Continuing despite test organizer notification failure`,
    );
  }
}

async function postToOrganizersChannel(
  speakerName: string,
  talkContext: string,
  isOnBehalf: boolean,
  submitterName: string | undefined,
  channelId: string,
): Promise<void> {
  console.log(
    `📢 [Discord] Starting organizer notification for speaker: "${speakerName}"`,
  );

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const organizersChannelId = Deno.env.get("DISCORD_ORGANIZERS_CHANNEL_ID");

  // Check environment variables
  if (!botToken) {
    console.warn(
      `⚠️ [Discord] DISCORD_BOT_TOKEN not found for organizer notification`,
    );
  }
  if (!organizersChannelId) {
    console.warn(
      `⚠️ [Discord] DISCORD_ORGANIZERS_CHANNEL_ID not found in environment variables`,
    );
  } else {
    console.log(
      `📋 [Discord] Using organizers channel ID: ${organizersChannelId}`,
    );
  }

  const submissionInfo = isOnBehalf && submitterName
    ? `Submitted by **${submitterName}** on behalf of the speaker`
    : isOnBehalf
    ? "Submitted by someone else on behalf of the speaker"
    : "Submitted by the speaker themselves";

  const message = `🎤 **New Talk Submission**
**Speaker:** ${speakerName}
**Talk Context:** ${talkContext}
**Submission Info:** ${submissionInfo}
**Discussion Channel:** ${
    channelId.includes("placeholder")
      ? "Channel creation failed"
      : `<#${channelId}>`
  }`;

  console.log(`📝 [Discord] Prepared organizer message:`);
  console.log(message);

  if (!botToken || !organizersChannelId) {
    console.log(
      `🔄 [Discord] Missing credentials for organizer notification, would have posted above message`,
    );
    return;
  }

  try {
    const messageData = {
      content: message,
    };

    console.log(
      `🚀 [Discord] Making API request to post to organizers channel ${organizersChannelId}`,
    );
    console.log(
      `📊 [Discord] Message data:`,
      JSON.stringify(messageData, null, 2),
    );

    const response = await fetch(
      `https://discord.com/api/v10/channels/${organizersChannelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageData),
      },
    );

    console.log(
      `📡 [Discord] Message API Response Status: ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [Discord] Message posting failed with status ${response.status}`,
      );
      console.error(`❌ [Discord] Error response body:`, errorText);

      try {
        const errorJson = JSON.parse(errorText);
        console.error(
          `❌ [Discord] Parsed message error:`,
          JSON.stringify(errorJson, null, 2),
        );

        // Provide specific error guidance
        if (errorJson.code === 50001) {
          console.error(
            `🔐 [Discord] Missing access to channel - check bot permissions`,
          );
        } else if (errorJson.code === 10003) {
          console.error(
            `🔍 [Discord] Channel not found - check DISCORD_ORGANIZERS_CHANNEL_ID`,
          );
        } else if (errorJson.code === 50013) {
          console.error(
            `🚫 [Discord] Missing permissions to send messages in this channel`,
          );
        }
      } catch {
        console.error(
          `❌ [Discord] Could not parse message error response as JSON`,
        );
      }

      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const messageResponse = await response.json();
    console.log(
      `✅ [Discord] Message posted successfully to organizers channel!`,
    );
    console.log(`📋 [Discord] Message ID: ${messageResponse.id}`);
    console.log(`⏰ [Discord] Message timestamp: ${messageResponse.timestamp}`);
  } catch (error) {
    console.error(
      `💥 [Discord] Exception during organizer notification:`,
      error,
    );
    console.error(`💥 [Discord] Error type:`, error.constructor.name);
    console.error(`💥 [Discord] Error message:`, error.message);
    if (error.stack) {
      console.error(`💥 [Discord] Stack trace:`, error.stack);
    }

    // Don't throw here - we don't want to fail the entire submission if organizer notification fails
    console.log(
      `🔄 [Discord] Continuing despite organizer notification failure`,
    );
  }
}

async function sendWelcomeMessage(
  channelId: string,
  speakerName: string,
  talkContext: string,
  isOnBehalf: boolean,
  submitterName: string | undefined,
): Promise<void> {
  console.log(`💬 [Discord] Sending welcome message to channel: ${channelId}`);

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");

  if (!botToken) {
    console.warn(
      `⚠️ [Discord] DISCORD_BOT_TOKEN not found for welcome message`,
    );
  }

  if (!botToken || channelId.includes("placeholder")) {
    console.log(
      `🔄 [Discord] Using placeholder mode, would send welcome message`,
    );
    return;
  }

  const submissionInfo = isOnBehalf && submitterName
    ? `Submitted by **${submitterName}** on behalf of the speaker`
    : isOnBehalf
    ? "Submitted by someone else on behalf of the speaker"
    : "Submitted by the speaker themselves";

  const welcomeMessage = `🎤 **Welcome to your talk discussion channel!**

**Speaker:** ${speakerName}
**Talk Context:** ${talkContext}
**Submission:** ${submissionInfo}

This channel has been created for you to discuss your talk proposal with the organizers. Feel free to share additional details, ask questions, or coordinate next steps here.

The organizers have been notified and will be in touch soon!`;

  console.log(`📝 [Discord] Prepared welcome message for channel ${channelId}`);

  try {
    const messageData = {
      content: welcomeMessage,
    };

    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageData),
      },
    );

    console.log(
      `📡 [Discord] Welcome message API Response Status: ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [Discord] Welcome message posting failed with status ${response.status}`,
      );
      console.error(`❌ [Discord] Error response body:`, errorText);
      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const messageResponse = await response.json();
    console.log(`✅ [Discord] Welcome message posted successfully!`);
    console.log(`📋 [Discord] Message ID: ${messageResponse.id}`);
  } catch (error) {
    console.error(`💥 [Discord] Exception during welcome message:`, error);
    console.error(`💥 [Discord] Error type:`, error.constructor.name);
    console.error(`💥 [Discord] Error message:`, error.message);
    if (error.stack) {
      console.error(`💥 [Discord] Stack trace:`, error.stack);
    }

    // Don't throw here - we don't want to fail the entire submission if welcome message fails
    console.log(`🔄 [Discord] Continuing despite welcome message failure`);
  }
}

export default app.fetch;
