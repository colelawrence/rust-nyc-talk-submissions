export interface DiscordConfig {
  botToken: string;
  guildId: string;
  organizersChannelId: string;
  categoryId?: string;
  testCategoryId?: string;
  testOrganizersChannelId?: string;
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
