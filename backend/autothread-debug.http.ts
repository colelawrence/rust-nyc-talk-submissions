/**
 * Autothread Debug Console
 *
 * HTTP endpoints for testing and debugging the autothread system.
 * Protected by ADMIN_TOKEN bearer auth.
 *
 * Environment Variables:
 * - ADMIN_TOKEN: Required for authentication
 * - ENABLE_TEST_API: Must be "true" to enable debug endpoints
 */

import { Hono } from "https://esm.sh/hono@3.11.7";
import { loadEnv } from "./config.ts";
import { makeDiscordService } from "./discord.ts";
import {
  runAutothread,
  AutothreadStore,
  DEFAULT_CONFIG,
  DEBUG_DEFAULT_CONFIG,
  evaluateMessageGates,
  generateThreadName,
  generateAIThreadName,
  gatherContextMessages,
  sanitizeContent,
} from "./autothread/index.ts";
import type {
  AutothreadConfig,
  ExecutionMode,
  Namespace,
} from "./autothread/index.ts";

const app = new Hono();

// Admin authentication middleware
function requireAdmin(req: Request): Response | null {
  const adminToken = Deno.env.get("ADMIN_TOKEN");
  const testApiEnabled =
    Deno.env.get("ENABLE_TEST_API")?.toLowerCase() === "true";

  if (!testApiEnabled) {
    return new Response(
      JSON.stringify({ error: "Debug API disabled. Set ENABLE_TEST_API=true" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!adminToken) {
    return new Response(
      JSON.stringify({ error: "ADMIN_TOKEN not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${adminToken}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

// Apply auth to all routes
app.use("*", async (c, next) => {
  const authError = requireAdmin(c.req.raw);
  if (authError) return authError;
  await next();
});

// Error handler
app.onError((err, c) => {
  console.error("Debug endpoint error:", err);
  return c.json({ error: err.message }, 500);
});

/**
 * GET /
 * List available debug endpoints
 */
app.get("/", (c) => {
  return c.json({
    endpoints: {
      "POST /run": "Trigger a debug run with custom config",
      "GET /state": "Inspect current database state",
      "GET /runs": "List recent runs",
      "GET /runs/:id/events": "Get events for a specific run",
      "POST /reset": "Reset sandbox state (requires confirm)",
      "POST /reset-cursor": "Reset a channel's cursor",
      "POST /clear-processed": "Clear processed messages",
      "GET /discord/channels": "Test Discord API - list channels",
      "GET /discord/messages": "Test Discord API - fetch messages",
      "POST /eval-message": "Evaluate gates for a message",
      "POST /generate-name": "Test thread name generation",
      "POST /generate-ai-name": "Test AI thread name generation",
    },
    defaults: {
      namespace: "sandbox",
      mode: "plan",
    },
  });
});

/**
 * POST /run
 * Trigger an autothread run with custom configuration
 */
app.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const namespace: Namespace = body.namespace ?? "sandbox";
  const mode: ExecutionMode = body.mode ?? "plan";

  // Safety: require explicit confirmation for live+prod
  if (mode === "live" && namespace === "prod") {
    if (body.confirm !== "LIVE_PROD") {
      return c.json(
        {
          error:
            'Live mode on prod requires confirm: "LIVE_PROD" in request body',
        },
        400,
      );
    }
  }

  const config: AutothreadConfig = {
    ...DEFAULT_CONFIG,
    ...DEBUG_DEFAULT_CONFIG,
    namespace,
    mode,
    enableAI: body.enableAI ?? false,
    channelAllowlist: body.allowlist ?? null,
    maxChannelsPerRun: Math.min(body.maxChannels ?? 1, 3),
    maxThreadsPerRun: Math.min(body.maxThreads ?? 2, 5),
    maxIterations: Math.min(body.iterations ?? 1, 3),
    runDurationMs: Math.min(body.durationMs ?? 10000, 30000),
  };

  const envConfig = loadEnv();
  const discord = makeDiscordService(envConfig.discord);

  console.log(
    `🔧 [Debug] Starting run: mode=${mode}, namespace=${namespace}, ai=${config.enableAI}`,
  );

  const result = await runAutothread(discord, config);

  return c.json({
    success: true,
    config: {
      mode: config.mode,
      namespace: config.namespace,
      enableAI: config.enableAI,
      maxIterations: config.maxIterations,
    },
    result,
  });
});

/**
 * GET /state
 * Inspect current database state
 */
app.get("/state", async (c) => {
  const namespace: Namespace =
    (c.req.query("namespace") as Namespace) ?? "sandbox";
  const store = new AutothreadStore(namespace);

  await store.initTables();
  const state = await store.getState();
  const lastRun = await store.getLastRun();

  return c.json({
    namespace,
    lastRun,
    ...state,
  });
});

/**
 * GET /runs
 * List recent runs
 */
app.get("/runs", async (c) => {
  const namespace: Namespace =
    (c.req.query("namespace") as Namespace) ?? "sandbox";
  const limit = parseInt(c.req.query("limit") ?? "10");
  const store = new AutothreadStore(namespace);

  await store.initTables();
  const runs = await store.getRuns(limit);

  return c.json({ namespace, runs });
});

/**
 * GET /runs/:id/events
 * Get events for a specific run
 */
app.get("/runs/:id/events", async (c) => {
  const namespace: Namespace =
    (c.req.query("namespace") as Namespace) ?? "sandbox";
  const runId = BigInt(c.req.param("id"));
  const store = new AutothreadStore(namespace);

  await store.initTables();
  const events = await store.getRunEvents(runId);

  return c.json({ namespace, runId: runId.toString(), events });
});

/**
 * POST /reset
 * Reset all sandbox state (requires confirm)
 */
app.post("/reset", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const namespace: Namespace = body.namespace ?? "sandbox";

  if (namespace === "prod") {
    return c.json({ error: "Cannot reset prod namespace" }, 400);
  }

  if (body.confirm !== "RESET_SANDBOX") {
    return c.json(
      { error: 'Requires confirm: "RESET_SANDBOX" in request body' },
      400,
    );
  }

  const store = new AutothreadStore(namespace);
  await store.initTables();
  await store.resetAll();

  return c.json({ success: true, message: `Reset ${namespace} namespace` });
});

/**
 * POST /reset-cursor
 * Reset a channel's cursor
 */
app.post("/reset-cursor", async (c) => {
  const body = await c.req.json();
  const namespace: Namespace = body.namespace ?? "sandbox";
  const { channelId, lastMessageId } = body;

  if (!channelId) {
    return c.json({ error: "channelId required" }, 400);
  }

  const store = new AutothreadStore(namespace);
  await store.initTables();
  await store.resetChannelCursor(channelId, lastMessageId ?? null);

  return c.json({
    success: true,
    channelId,
    lastMessageId: lastMessageId ?? null,
  });
});

/**
 * POST /clear-processed
 * Clear processed messages with optional filters
 */
app.post("/clear-processed", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const namespace: Namespace = body.namespace ?? "sandbox";

  if (namespace === "prod" && body.confirm !== "CLEAR_PROD") {
    return c.json(
      { error: 'Clearing prod requires confirm: "CLEAR_PROD"' },
      400,
    );
  }

  const store = new AutothreadStore(namespace);
  await store.initTables();
  const deleted = await store.clearProcessed(
    body.channelId,
    body.before,
    body.status,
  );

  return c.json({ success: true, deleted });
});

/**
 * GET /discord/channels
 * Test Discord API connectivity
 */
app.get("/discord/channels", async (c) => {
  const envConfig = loadEnv();
  const discord = makeDiscordService(envConfig.discord);

  const channels = await discord.listGuildChannels();

  return c.json({
    count: channels.length,
    channels: channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      topic: ch.topic,
    })),
  });
});

/**
 * GET /discord/messages
 * Fetch messages from a channel
 */
app.get("/discord/messages", async (c) => {
  const channelId = c.req.query("channelId");
  const after = c.req.query("after");
  const before = c.req.query("before");
  const limit = parseInt(c.req.query("limit") ?? "20");

  if (!channelId) {
    return c.json({ error: "channelId query param required" }, 400);
  }

  const envConfig = loadEnv();
  const discord = makeDiscordService(envConfig.discord);

  const messages = await discord.getMessages(channelId, {
    after: after ?? undefined,
    before: before ?? undefined,
    limit: Math.min(limit, 100),
  });

  return c.json({
    count: messages.length,
    messages: messages.map((m) => ({
      id: m.id,
      author: m.author.username,
      isBot: m.author.bot,
      content: m.content.slice(0, 100) + (m.content.length > 100 ? "..." : ""),
      hasThread: !!m.thread,
      timestamp: m.timestamp,
    })),
  });
});

/**
 * POST /eval-message
 * Evaluate gates for a message (by content or fetched by ID)
 */
app.post("/eval-message", async (c) => {
  const body = await c.req.json();

  // Option 1: Provide message content directly
  if (body.content) {
    const mockMessage = {
      id: "mock",
      channel_id: "mock",
      author: { id: "mock", username: body.author ?? "test", discriminator: "0", bot: body.isBot ?? false },
      content: body.content,
      timestamp: new Date().toISOString(),
      thread: body.hasThread ? { id: "mock", name: "mock" } : null,
    };

    const evaluation = evaluateMessageGates(mockMessage);
    return c.json({
      input: { content: body.content, isBot: body.isBot, hasThread: body.hasThread },
      evaluation,
      suggestedThreadName: evaluation.passed ? generateThreadName(mockMessage) : null,
    });
  }

  // Option 2: Fetch by channel + message ID
  if (body.channelId && body.messageId) {
    const envConfig = loadEnv();
    const discord = makeDiscordService(envConfig.discord);

    const messages = await discord.getMessages(body.channelId, { limit: 50 });
    const message = messages.find((m) => m.id === body.messageId);

    if (!message) {
      return c.json({ error: "Message not found" }, 404);
    }

    const evaluation = evaluateMessageGates(message);
    return c.json({
      message: {
        id: message.id,
        author: message.author.username,
        content: message.content.slice(0, 200),
      },
      evaluation,
      suggestedThreadName: evaluation.passed ? generateThreadName(message) : null,
    });
  }

  return c.json({ error: "Provide content or channelId+messageId" }, 400);
});

/**
 * POST /generate-name
 * Test deterministic thread name generation
 */
app.post("/generate-name", async (c) => {
  const body = await c.req.json();

  if (!body.content) {
    return c.json({ error: "content required" }, 400);
  }

  const mockMessage = {
    id: "mock",
    channel_id: "mock",
    author: { id: "mock", username: body.author ?? "test", discriminator: "0" },
    content: body.content,
    timestamp: body.timestamp ?? new Date().toISOString(),
    thread: null,
  };

  const threadName = generateThreadName(mockMessage);
  const sanitized = sanitizeContent(body.content);

  return c.json({
    input: body.content,
    sanitized,
    sanitizedLength: sanitized.length,
    threadName,
    usedFallback: sanitized.length < 10,
  });
});

/**
 * POST /generate-ai-name
 * Test AI thread name generation
 */
app.post("/generate-ai-name", async (c) => {
  const body = await c.req.json();

  if (!body.content) {
    return c.json({ error: "content required" }, 400);
  }

  const targetMessage = {
    id: "mock",
    channel_id: "mock",
    author: { id: "mock", username: body.author ?? "test", discriminator: "0" },
    content: body.content,
    timestamp: new Date().toISOString(),
    thread: null,
  };

  const contextMessages = (body.context ?? []).map(
    (ctx: { author?: string; content: string }, i: number) => ({
      id: `ctx-${i}`,
      channel_id: "mock",
      author: { id: `ctx-${i}`, username: ctx.author ?? `user${i}`, discriminator: "0" },
      content: ctx.content,
      timestamp: new Date().toISOString(),
      thread: null,
    }),
  );

  const result = await generateAIThreadName(targetMessage, contextMessages);

  return c.json({
    input: {
      content: body.content,
      contextCount: contextMessages.length,
    },
    result: result ?? { error: "AI generation failed, would use fallback" },
    fallbackName: generateThreadName(targetMessage),
  });
});

// Export Hono app for mounting via app.route() in index.ts
// The .http.ts suffix tells Val Town this is an HTTP trigger
export default app;
