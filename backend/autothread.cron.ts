/**
 * Auto-Threading Cron Job
 *
 * Polls Discord channels with `[autothread]` in their topic and creates threads
 * on new messages. Uses high-frequency internal polling (every 5 seconds) within
 * each cron execution to approximate real-time behavior.
 *
 * Environment Variables:
 * - DISCORD_BOT_TOKEN: Required for Discord API access
 * - DISCORD_GUILD_ID: Required guild to monitor
 * - AUTOTHREAD_DRY_RUN: When "true", logs but doesn't create threads
 * - AUTOTHREAD_ENABLE_AI: When "true", use AI for thread naming
 * - AUTOTHREAD_CHANNEL_ALLOWLIST: Comma-separated channel IDs to process
 */

import { loadEnv } from "./config.ts";
import { makeDiscordService } from "./discord.ts";
import { runAutothread, DEFAULT_CONFIG } from "./autothread/index.ts";
import type { AutothreadConfig, ExecutionMode } from "./autothread/index.ts";
import { logError } from "./errors.ts";

function getAutothreadConfig(): Partial<AutothreadConfig> {
  const dryRun = Deno.env.get("AUTOTHREAD_DRY_RUN")?.toLowerCase() === "true";
  const enableAI =
    Deno.env.get("AUTOTHREAD_ENABLE_AI")?.toLowerCase() === "true";
  const allowlist = Deno.env.get("AUTOTHREAD_CHANNEL_ALLOWLIST");
  const channelAllowlist = allowlist
    ? allowlist.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const mode: ExecutionMode = dryRun ? "dry_run" : "live";

  return {
    mode,
    enableAI,
    channelAllowlist,
  };
}

export default async function () {
  console.log(`🚀 [Autothread] Cron job started`);

  try {
    const config = loadEnv();

    if (!config.discord) {
      console.warn(
        `⚠️ [Autothread] Discord not configured, running in noop mode`,
      );
    }

    const discord = makeDiscordService(config.discord);
    const autothreadEnvConfig = getAutothreadConfig();

    const fullConfig: AutothreadConfig = {
      ...DEFAULT_CONFIG,
      ...autothreadEnvConfig,
      namespace: "prod", // Cron always uses prod
    };

    console.log(
      `⚙️ [Autothread] Config: mode=${fullConfig.mode}, enableAI=${fullConfig.enableAI}, namespace=${fullConfig.namespace}, allowlist=${fullConfig.channelAllowlist?.join(",") ?? "all"}`,
    );

    const result = await runAutothread(discord, fullConfig);

    // Log detailed results for observability
    console.log(
      `✅ [Autothread] Cron complete. Status: ${result.status}, Threads: ${result.threadsCreated}, Errors: ${result.errorCount}, Duration: ${result.durationMs}ms, Iterations: ${result.iterations}`,
    );

    if (result.plannedActions.length > 0) {
      console.log(
        `📋 [Autothread] Actions: ${JSON.stringify(result.plannedActions)}`,
      );
    }

    if (result.errorCount > 0) {
      console.error(
        `❌ [Autothread] Last error: ${result.lastError}`,
      );
      // Log error-level events for visibility
      const errorEvents = result.events.filter((e) => e.level === "error");
      for (const evt of errorEvents) {
        console.error(
          `❌ [Autothread] Event: ${evt.event} channel=${evt.channelId ?? "?"} msg=${evt.messageId ?? "?"} ${JSON.stringify(evt.details ?? {})}`,
        );
      }
    }
  } catch (error) {
    logError("Autothread:Cron", error);
    // Re-throw so Val Town marks the cron run as failed
    throw error;
  }
}
