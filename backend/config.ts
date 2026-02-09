export interface DiscordConfig {
  botToken: string;
  guildId: string;
  organizersChannelId: string;
  categoryId?: string;
  testCategoryId?: string;
  testOrganizersChannelId?: string;
  inviteMaxAge: number;
}

export interface RuntimeConfig {
  discord?: DiscordConfig;
  enableTestApi: boolean;
}

export function loadEnv(): RuntimeConfig {
  console.log(`🔍 [Config] Loading environment configuration...`);

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const guildId = Deno.env.get("DISCORD_GUILD_ID");
  const organizersChannelId = Deno.env.get("DISCORD_ORGANIZERS_CHANNEL_ID");
  const categoryId = Deno.env.get("DISCORD_CATEGORY_ID");
  const testCategoryId = Deno.env.get("DISCORD_TEST_CATEGORY_ID");
  const testOrganizersChannelId = Deno.env.get(
    "DISCORD_TEST_ORGANIZERS_CHANNEL_ID",
  );
  const testApiEnabled = Deno.env.get("ENABLE_TEST_API");
  
  // Parse and validate invite max age (default: 7 days)
  const inviteMaxAgeStr = Deno.env.get("DISCORD_INVITE_MAX_AGE_SECONDS");
  const inviteMaxAge = inviteMaxAgeStr ? parseInt(inviteMaxAgeStr, 10) : 604800;
  
  if (isNaN(inviteMaxAge) || (inviteMaxAge !== 0 && (inviteMaxAge < 1 || inviteMaxAge > 604800))) {
    throw new Error(
      `DISCORD_INVITE_MAX_AGE_SECONDS must be 0 or an integer between 1 and 604800 (7 days). Got: ${inviteMaxAgeStr}`
    );
  }

  console.log(
    `🤖 [Config] Bot Token: ${botToken ? "✅ Present" : "❌ Missing"}`,
  );
  console.log(
    `🏠 [Config] Guild ID: ${guildId ? "✅ Present" : "❌ Missing"}`,
  );
  console.log(
    `📢 [Config] Organizers Channel: ${
      organizersChannelId ? "✅ Present" : "❌ Missing"
    }`,
  );
  console.log(
    `📁 [Config] Category ID: ${
      categoryId ? "✅ Present" : "⚪ Optional (not set)"
    }`,
  );
  console.log(
    `🧪 [Config] Test Category ID: ${
      testCategoryId ? "✅ Present" : "⚪ Optional (not set)"
    }`,
  );
  console.log(
    `🧪 [Config] Test Organizers Channel: ${
      testOrganizersChannelId ? "✅ Present" : "⚪ Optional (not set)"
    }`,
  );
  console.log(
    `🧪 [Config] Test API Enabled: ${
      testApiEnabled?.toLowerCase() === "true" ? "✅ Enabled" : "⚪ Disabled"
    }`,
  );
  console.log(
    `⏰ [Config] Invite Max Age: ${inviteMaxAge === 0 ? "Never expires" : `${inviteMaxAge}s (${Math.floor(inviteMaxAge / 86400)}d ${Math.floor((inviteMaxAge % 86400) / 3600)}h)`}`,
  );

  const isFullyConfigured = botToken && guildId && organizersChannelId;

  let discord: DiscordConfig | undefined;

  if (isFullyConfigured) {
    discord = {
      botToken: botToken!,
      guildId: guildId!,
      organizersChannelId: organizersChannelId!,
      categoryId,
      testCategoryId,
      testOrganizersChannelId,
      inviteMaxAge,
    };
    console.log(`✅ [Config] Full Discord integration enabled`);
  } else {
    console.log(`⚠️ [Config] Discord integration will use placeholder mode`);
    console.log(
      `ℹ️ [Config] To enable full integration, set: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_ORGANIZERS_CHANNEL_ID`,
    );
  }

  return {
    discord,
    enableTestApi: testApiEnabled?.toLowerCase() === "true",
  };
}
