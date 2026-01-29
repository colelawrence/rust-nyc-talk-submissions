/**
 * Autothread Runner
 *
 * High-level runner that executes the autothread logic with configurable options.
 * Used by both the cron job and debug endpoints.
 */

import type { DiscordService } from "../discord.ts";
import { AutothreadStore } from "./store.ts";
import { pollAndProcessMessages } from "./logic.ts";
import type {
  AutothreadConfig,
  RunContext,
  RunResult,
  DEFAULT_CONFIG,
} from "./types.ts";

export async function runAutothread(
  discord: DiscordService,
  config: AutothreadConfig,
): Promise<RunResult> {
  const startTime = Date.now();
  const store = new AutothreadStore(config.namespace);

  // Initialize tables
  await store.initTables();

  // Start run tracking
  const runId = await store.startRun(config.mode);

  const ctx: RunContext = {
    runId,
    threadsCreatedThisRun: 0,
    errorsThisRun: 0,
    lastError: null,
    events: [],
  };

  const allActions: RunResult["plannedActions"] = [];
  let iterationCount = 0;

  try {
    // Run polling loop
    while (Date.now() - startTime < config.runDurationMs) {
      if (iterationCount >= config.maxIterations) {
        break;
      }

      iterationCount++;
      console.log(
        `🔄 [Autothread:${config.namespace}] Poll iteration ${iterationCount}`,
      );

      try {
        const actions = await pollAndProcessMessages(discord, store, config, ctx);
        allActions.push(...actions);
      } catch (err) {
        ctx.errorsThisRun++;
        ctx.lastError = err instanceof Error ? err.message : String(err);
        console.error(`❌ [Autothread] Poll error:`, err);
      }

      // Check caps
      if (ctx.threadsCreatedThisRun >= config.maxThreadsPerRun) {
        console.log(`⚠️ [Autothread] Thread cap reached, stopping early`);
        break;
      }

      // Wait before next poll (skip if single iteration)
      if (config.maxIterations > 1 && Date.now() - startTime < config.runDurationMs) {
        await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
      }
    }
  } catch (err) {
    ctx.errorsThisRun++;
    ctx.lastError = err instanceof Error ? err.message : String(err);
  }

  // Determine final status
  const status =
    ctx.errorsThisRun > 0
      ? "completed_with_errors"
      : "ok";

  // End run tracking
  await store.endRun(
    runId,
    status,
    iterationCount,
    ctx.threadsCreatedThisRun,
    ctx.errorsThisRun,
    ctx.lastError,
  );

  // Persist events
  for (const event of ctx.events) {
    await store.logEvent(runId, event);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `✅ [Autothread:${config.namespace}] Run complete. Iterations: ${iterationCount}, Threads: ${ctx.threadsCreatedThisRun}, Errors: ${ctx.errorsThisRun}, Duration: ${durationMs}ms`,
  );

  return {
    runId,
    status,
    iterations: iterationCount,
    threadsCreated: ctx.threadsCreatedThisRun,
    errorCount: ctx.errorsThisRun,
    lastError: ctx.lastError,
    plannedActions: allActions,
    events: ctx.events,
    durationMs,
  };
}
