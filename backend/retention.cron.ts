/**
 * Retention Cron Job
 *
 * Cleans up old records from non-critical tables to prevent unbounded growth.
 * Uses batched deletes and graceful lock failure handling.
 *
 * Environment Variables:
 * - AUTOTHREAD_LOG_RETENTION_DAYS: Days to retain autothread logs (default: 30, 0 = disabled)
 * - RATE_LIMIT_RETENTION_DAYS: Days to retain rate limit data (default: 30, 0 = disabled)
 */

import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";
import { loadEnv } from "./config.ts";
import { logError } from "./errors.ts";

/** Tables eligible for retention cleanup */
const ALLOWED_TABLES = [
  "autothread_processed_1",
  "autothread_processed_1_sandbox",
  "rate_limit_store",
] as const;

type AllowedTable = typeof ALLOWED_TABLES[number];

interface RetentionTask {
  table: AllowedTable;
  cutoffDate: Date;
  timestampColumn: string;
  /** True if column stores epoch milliseconds, false for DATETIME string */
  isEpochMs: boolean;
}

/**
 * Execute a single batched delete
 * @returns Number of rows deleted, or null if lock failed
 */
async function batchDelete(
  table: string,
  column: string,
  cutoffValue: string | number,
  batchSize: number,
): Promise<number | null> {
  try {
    const result = await sqlite.execute(
      `DELETE FROM ${table} WHERE rowid IN (
         SELECT rowid FROM ${table} WHERE ${column} < ? LIMIT ?
       )`,
      [cutoffValue, batchSize],
    );

    return result.rowsAffected;
  } catch (error) {
    // Check if it's a lock error
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes("sqlite_busy") ||
        message.includes("database is locked")
      ) {
        return null; // Signal lock failure
      }
    }

    // Re-throw non-lock errors
    throw error;
  }
}

/**
 * Clean up a single table with batched deletes
 */
async function cleanupTable(task: RetentionTask): Promise<number> {
  const cutoffValue = task.isEpochMs
    ? task.cutoffDate.getTime() // epoch milliseconds
    : task.cutoffDate.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""); // DATETIME string

  console.log(
    `🧹 [Retention] Cleaning ${task.table} (${task.timestampColumn} < ${task.isEpochMs ? new Date(cutoffValue as number).toISOString() : cutoffValue})`,
  );

  const BATCH_SIZE = 100;
  let totalDeleted = 0;

  while (true) {
    const deleted = await batchDelete(
      task.table,
      task.timestampColumn,
      cutoffValue,
      BATCH_SIZE,
    );

    if (deleted === null) {
      console.warn(
        `⚠️ [Retention] Lock failure on ${task.table}, skipping remaining batches`,
      );
      break;
    }

    totalDeleted += deleted;

    if (deleted < BATCH_SIZE) {
      // No more rows to delete
      break;
    }
  }

  return totalDeleted;
}

export default async function () {
  console.log(`🚀 [Retention] Cron job started`);

  try {
    // Note: Val Town sqlite API rejects PRAGMA statements (e.g. busy_timeout).
    // We handle lock errors by skipping the affected table for this run.

    // Load config (catch and log errors instead of throwing)
    let config;
    try {
      config = loadEnv();
    } catch (error) {
      console.error(`💥 [Retention] Failed to load config, skipping run:`, error);
      return;
    }

    const { autothreadLogRetentionDays, rateLimitRetentionDays } =
      config.retention;

    console.log(
      `⚙️ [Retention] Config: autothread=${autothreadLogRetentionDays}d, rateLimit=${rateLimitRetentionDays}d`,
    );

    const now = Date.now();
    const tasks: RetentionTask[] = [];

    // Build cleanup tasks based on retention config
    if (autothreadLogRetentionDays > 0) {
      const cutoffDate = new Date(
        now - autothreadLogRetentionDays * 24 * 60 * 60 * 1000,
      );
      tasks.push({
        table: "autothread_processed_1",
        cutoffDate,
        timestampColumn: "processed_at",
        isEpochMs: false,
      });
      tasks.push({
        table: "autothread_processed_1_sandbox",
        cutoffDate,
        timestampColumn: "processed_at",
        isEpochMs: false,
      });
    }

    if (rateLimitRetentionDays > 0) {
      const cutoffDate = new Date(
        now - rateLimitRetentionDays * 24 * 60 * 60 * 1000,
      );
      tasks.push({
        table: "rate_limit_store",
        cutoffDate,
        timestampColumn: "updated_at",
        isEpochMs: true,
      });
    }

    if (tasks.length === 0) {
      console.log(`⚪ [Retention] All retention policies disabled, nothing to clean`);
      return;
    }

    // Execute cleanup tasks
    const results: Record<string, number> = {};
    for (const task of tasks) {
      try {
        const deleted = await cleanupTable(task);
        results[task.table] = deleted;
        console.log(
          `✅ [Retention] ${task.table}: deleted ${deleted} rows`,
        );
      } catch (error) {
        console.error(
          `💥 [Retention] Failed to clean ${task.table}:`,
          error,
        );
        results[task.table] = 0;
      }
    }

    const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(
      `✅ [Retention] Cron complete. Total deleted: ${totalDeleted} rows`,
    );
  } catch (error) {
    logError("Retention:Cron", error);
    // Re-throw so Val Town marks the cron run as failed
    throw error;
  }
}
