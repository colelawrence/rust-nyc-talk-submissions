/**
 * Autothread Store
 *
 * Database operations for the autothread system with namespace support.
 */

import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";
import type { Namespace, TableNames, RunEvent } from "./types.ts";
import { getTableNames } from "./types.ts";

function toSqliteTimestamp(date: Date): string {
  // Matches SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS" (UTC)
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export class AutothreadStore {
  public readonly tables: TableNames;

  constructor(public readonly namespace: Namespace) {
    this.tables = getTableNames(namespace);
  }

  async initTables(): Promise<void> {
    console.log(
      `💾 [Autothread:${this.namespace}] Initializing database tables`,
    );

    await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${this.tables.channels} (
      channel_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      topic TEXT,
      last_message_id TEXT,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${this.tables.processed} (
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      thread_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, message_id)
    )`);

    await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${this.tables.stats} (
      channel_id TEXT NOT NULL,
      date TEXT NOT NULL,
      threads_created INTEGER DEFAULT 0,
      last_thread_at DATETIME,
      PRIMARY KEY (channel_id, date)
    )`);

    await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${this.tables.runs} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME NOT NULL,
      ended_at DATETIME,
      status TEXT NOT NULL,
      mode TEXT,
      iterations INTEGER DEFAULT 0,
      threads_created INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      last_error TEXT
    )`);

    await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${this.tables.events} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      details_json TEXT
    )`);

    console.log(`✅ [Autothread:${this.namespace}] Database tables ready`);
  }

  // Run tracking
  async startRun(mode: string): Promise<bigint> {
    const result = await sqlite.execute(
      `INSERT INTO ${this.tables.runs} (started_at, status, mode) VALUES (CURRENT_TIMESTAMP, 'running', ?)`,
      [mode],
    );
    return result.lastInsertRowid!;
  }

  async endRun(
    runId: bigint,
    status: string,
    iterations: number,
    threadsCreated: number,
    errorCount: number,
    lastError: string | null,
  ): Promise<void> {
    await sqlite.execute(
      `UPDATE ${this.tables.runs} SET
         ended_at = CURRENT_TIMESTAMP,
         status = ?,
         iterations = ?,
         threads_created = ?,
         error_count = ?,
         last_error = ?
       WHERE id = ?`,
      [status, iterations, threadsCreated, errorCount, lastError, runId.toString()],
    );
  }

  async getLastRun(): Promise<Record<string, unknown> | null> {
    const result = await sqlite.execute(
      `SELECT * FROM ${this.tables.runs} ORDER BY id DESC LIMIT 1`,
    );
    return (result.rows[0] as Record<string, unknown>) ?? null;
  }

  async getRuns(limit = 10): Promise<Record<string, unknown>[]> {
    const result = await sqlite.execute(
      `SELECT * FROM ${this.tables.runs} ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    return result.rows as Record<string, unknown>[];
  }

  // Event logging
  async logEvent(runId: bigint | null, event: RunEvent): Promise<void> {
    await sqlite.execute(
      `INSERT INTO ${this.tables.events} (run_id, ts, level, event, channel_id, message_id, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        runId ? runId.toString() : null,
        event.timestamp,
        event.level,
        event.event,
        event.channelId ?? null,
        event.messageId ?? null,
        event.details ? JSON.stringify(event.details) : null,
      ],
    );
  }

  async getRunEvents(runId: bigint): Promise<Record<string, unknown>[]> {
    const result = await sqlite.execute(
      `SELECT * FROM ${this.tables.events} WHERE run_id = ? ORDER BY id`,
      [runId.toString()],
    );
    return result.rows as Record<string, unknown>[];
  }

  // Channel state
  async getLastMessageId(channelId: string): Promise<string | null> {
    const result = await sqlite.execute(
      `SELECT last_message_id FROM ${this.tables.channels} WHERE channel_id = ?`,
      [channelId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as unknown as {
      last_message_id?: string | null;
    };
    return row.last_message_id ?? null;
  }

  async updateChannelState(
    channelId: string,
    name: string,
    topic: string | null,
    lastMessageId?: string,
  ): Promise<void> {
    await sqlite.execute(
      `INSERT INTO ${this.tables.channels} (channel_id, name, topic, last_message_id, last_seen_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id) DO UPDATE SET
         name = excluded.name,
         topic = excluded.topic,
         last_message_id = COALESCE(excluded.last_message_id, last_message_id),
         last_seen_at = CURRENT_TIMESTAMP`,
      [channelId, name, topic, lastMessageId ?? null],
    );
  }

  async resetChannelCursor(
    channelId: string,
    lastMessageId: string | null,
  ): Promise<void> {
    await sqlite.execute(
      `UPDATE ${this.tables.channels} SET last_message_id = ? WHERE channel_id = ?`,
      [lastMessageId, channelId],
    );
  }

  // Message processing
  async tryClaimMessage(
    channelId: string,
    messageId: string,
    status: "dry_run" | "processing" | "skipped" | "planned",
  ): Promise<boolean> {
    try {
      await sqlite.execute(
        `INSERT INTO ${this.tables.processed} (channel_id, message_id, status)
         VALUES (?, ?, ?)`,
        [channelId, messageId, status],
      );
      return true;
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        return false;
      }
      throw err;
    }
  }

  async updateMessageStatus(
    channelId: string,
    messageId: string,
    status: "created" | "error",
    threadId?: string,
    error?: string,
  ): Promise<void> {
    await sqlite.execute(
      `UPDATE ${this.tables.processed}
       SET status = ?, thread_id = ?, error = ?, processed_at = CURRENT_TIMESTAMP
       WHERE channel_id = ? AND message_id = ?`,
      [status, threadId ?? null, error ?? null, channelId, messageId],
    );
  }

  async isMessageProcessed(
    channelId: string,
    messageId: string,
  ): Promise<boolean> {
    const result = await sqlite.execute(
      `SELECT 1 FROM ${this.tables.processed} WHERE channel_id = ? AND message_id = ?`,
      [channelId, messageId],
    );
    return result.rows.length > 0;
  }

  // Cooldown
  async isChannelOnCooldown(
    channelId: string,
    windowMs: number,
    maxThreads: number,
  ): Promise<boolean> {
    const cutoff = toSqliteTimestamp(new Date(Date.now() - windowMs));
    const result = await sqlite.execute(
      `SELECT COUNT(*) as count FROM ${this.tables.processed}
       WHERE channel_id = ? AND status = 'created' AND processed_at > ?`,
      [channelId, cutoff],
    );
    const row = result.rows[0] as unknown as {
      count?: number | string | bigint;
    };
    const count = Number(row.count ?? 0);
    return count >= maxThreads;
  }

  // Stats
  async recordThreadCreated(channelId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await sqlite.execute(
      `INSERT INTO ${this.tables.stats} (channel_id, date, threads_created, last_thread_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, date) DO UPDATE SET
         threads_created = threads_created + 1,
         last_thread_at = CURRENT_TIMESTAMP`,
      [channelId, today],
    );
  }

  async getTodayStats(): Promise<Record<string, unknown>[]> {
    const today = new Date().toISOString().slice(0, 10);
    const result = await sqlite.execute(
      `SELECT channel_id, threads_created, last_thread_at
       FROM ${this.tables.stats} WHERE date = ?
       ORDER BY threads_created DESC`,
      [today],
    );
    return result.rows as Record<string, unknown>[];
  }

  // Debug/reset operations
  async getState(): Promise<{
    channels: Record<string, unknown>[];
    recentProcessed: Record<string, unknown>[];
    todayStats: Record<string, unknown>[];
  }> {
    const channels = await sqlite.execute(
      `SELECT * FROM ${this.tables.channels} ORDER BY last_seen_at DESC LIMIT 20`,
    );
    const processed = await sqlite.execute(
      `SELECT * FROM ${this.tables.processed} ORDER BY processed_at DESC LIMIT 50`,
    );
    const stats = await this.getTodayStats();
    return {
      channels: channels.rows as Record<string, unknown>[],
      recentProcessed: processed.rows as Record<string, unknown>[],
      todayStats: stats,
    };
  }

  async clearProcessed(
    channelId?: string,
    beforeDate?: string,
    status?: string,
  ): Promise<number> {
    let sql = `DELETE FROM ${this.tables.processed} WHERE 1=1`;
    const args: (string | null)[] = [];

    if (channelId) {
      sql += ` AND channel_id = ?`;
      args.push(channelId);
    }
    if (beforeDate) {
      sql += ` AND processed_at < ?`;
      args.push(beforeDate);
    }
    if (status) {
      sql += ` AND status = ?`;
      args.push(status);
    }

    const result = await sqlite.execute(sql, args);
    return result.rowsAffected;
  }

  async resetAll(): Promise<void> {
    await sqlite.execute(`DELETE FROM ${this.tables.processed}`);
    await sqlite.execute(`DELETE FROM ${this.tables.channels}`);
    await sqlite.execute(`DELETE FROM ${this.tables.stats}`);
    await sqlite.execute(`DELETE FROM ${this.tables.runs}`);
    await sqlite.execute(`DELETE FROM ${this.tables.events}`);
  }
}
