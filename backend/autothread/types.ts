/**
 * Autothread Types
 *
 * Shared type definitions for the autothread system.
 */

import type { DiscordMessage } from "../discord.ts";

// Execution modes for debug/testing
export type ExecutionMode = "plan" | "dry_run" | "live";

// Storage namespace for table isolation
export type Namespace = "prod" | "sandbox";

// Run configuration
export interface AutothreadConfig {
  mode: ExecutionMode;
  namespace: Namespace;
  enableAI: boolean;
  channelAllowlist: string[] | null;
  maxChannelsPerRun: number;
  maxThreadsPerRun: number;
  maxIterations: number;
  pollIntervalMs: number;
  runDurationMs: number;
}

// Default configurations
export const DEFAULT_CONFIG: AutothreadConfig = {
  mode: "live",
  namespace: "prod",
  enableAI: false,
  channelAllowlist: null,
  maxChannelsPerRun: 3,
  maxThreadsPerRun: 5,
  maxIterations: 11,
  pollIntervalMs: 5000,
  runDurationMs: 55000,
};

export const DEBUG_DEFAULT_CONFIG: Partial<AutothreadConfig> = {
  mode: "plan",
  namespace: "sandbox",
  maxChannelsPerRun: 1,
  maxThreadsPerRun: 2,
  maxIterations: 1,
  runDurationMs: 10000,
};

// Table names by namespace
export interface TableNames {
  channels: string;
  processed: string;
  stats: string;
  runs: string;
  events: string;
}

export function getTableNames(namespace: Namespace): TableNames {
  const suffix = namespace === "sandbox" ? "_sandbox" : "";
  return {
    channels: `autothread_channels_1${suffix}`,
    processed: `autothread_processed_1${suffix}`,
    stats: `autothread_stats_1${suffix}`,
    runs: `autothread_runs_1${suffix}`,
    events: `autothread_events_1${suffix}`,
  };
}

// Run context (mutable state during a run)
export interface RunContext {
  runId: bigint | null;
  threadsCreatedThisRun: number;
  errorsThisRun: number;
  lastError: string | null;
  events: RunEvent[];
}

// Event for logging/tracing
export interface RunEvent {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  channelId?: string;
  messageId?: string;
  details?: Record<string, unknown>;
}

// Planned action (for plan mode)
export interface PlannedAction {
  type: "create_thread" | "skip" | "cooldown" | "error";
  channelId: string;
  channelName: string;
  messageId?: string;
  reason?: string;
  threadName?: string;
  wouldPostSummary?: boolean;
}

// Run result
export interface RunResult {
  runId: bigint | null;
  status: "ok" | "completed_with_errors" | "error";
  iterations: number;
  threadsCreated: number;
  errorCount: number;
  lastError: string | null;
  plannedActions: PlannedAction[];
  events: RunEvent[];
  durationMs: number;
}

// AI thread result
export interface AIThreadResult {
  threadName: string;
  summary: string | null;
}

// Gate evaluation result (for debugging)
export interface GateEvaluation {
  messageId: string;
  passed: boolean;
  gates: {
    name: string;
    passed: boolean;
    reason?: string;
  }[];
}
