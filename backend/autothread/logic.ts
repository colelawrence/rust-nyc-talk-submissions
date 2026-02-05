/**
 * Autothread Logic
 *
 * Core processing logic for the autothread system.
 * Extracted from autothread.cron.ts to be callable from both cron and debug endpoints.
 */

import { OpenAI } from "https://esm.town/v/std/openai";
import type { DiscordChannel, DiscordMessage, DiscordService } from "../discord.ts";
import { isThreadAlreadyExistsError } from "../errors.ts";
import type { AutothreadStore } from "./store.ts";
import type {
  AutothreadConfig,
  RunContext,
  RunEvent,
  PlannedAction,
  AIThreadResult,
  GateEvaluation,
} from "./types.ts";

// Constants
const COOLDOWN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_THREADS_PER_CHANNEL_PER_WINDOW = 3;
const MAX_THREAD_NAME_LENGTH = 97; // Discord allows 100; leave room for "..."
const MIN_MESSAGE_LENGTH = 10;

// Regex patterns for content filtering
const COMMAND_PREFIXES = /^[!/.]/;
const EMOJI_ONLY = /^[\p{Emoji}\s]+$/u;
const LINK_ONLY = /^(<?(https?:\/\/\S+?)>?\s*)+$/;
const MENTION_ONLY = /^(<@!?\d+>|<@&\d+>|<#\d+>|\s)+$/;

// Helper functions
export function sanitizeContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function hasAutothreadTag(topic: string | null | undefined): boolean {
  if (!topic) return false;
  return /\[autothread(?::[^\]]+)?\]/i.test(topic);
}

export function hasQuietMode(topic: string | null | undefined): boolean {
  if (!topic) return false;
  return topic.toLowerCase().includes("[autothread:quiet]");
}

export function generateThreadName(msg: DiscordMessage): string {
  const sanitized = sanitizeContent(msg.content);

  if (sanitized.length >= MIN_MESSAGE_LENGTH) {
    if (sanitized.length > MAX_THREAD_NAME_LENGTH) {
      return sanitized.slice(0, MAX_THREAD_NAME_LENGTH - 3) + "...";
    }
    return sanitized;
  }

  const timestamp = new Date(msg.timestamp);
  const hours = timestamp.getUTCHours().toString().padStart(2, "0");
  const minutes = timestamp.getUTCMinutes().toString().padStart(2, "0");
  return `Discussion from ${msg.author.username} @ ${hours}:${minutes}`;
}

// Gate evaluation
export function evaluateMessageGates(msg: DiscordMessage): GateEvaluation {
  const gates: GateEvaluation["gates"] = [];

  // Gate 1: Bot check
  const isBot = msg.author.bot === true;
  gates.push({
    name: "not_bot",
    passed: !isBot,
    reason: isBot ? "Author is a bot" : undefined,
  });

  // Gate 2: Already has thread
  const hasThread = !!msg.thread;
  gates.push({
    name: "no_existing_thread",
    passed: !hasThread,
    reason: hasThread ? "Message already has a thread" : undefined,
  });

  const sanitized = sanitizeContent(msg.content);

  // Gate 3: Minimum length
  const tooShort = sanitized.length < MIN_MESSAGE_LENGTH;
  gates.push({
    name: "min_length",
    passed: !tooShort,
    reason: tooShort
      ? `Content too short (${sanitized.length} < ${MIN_MESSAGE_LENGTH})`
      : undefined,
  });

  // Gate 4: Command prefix
  const isCommand = COMMAND_PREFIXES.test(sanitized);
  gates.push({
    name: "not_command",
    passed: !isCommand,
    reason: isCommand ? "Starts with command prefix (!, /, .)" : undefined,
  });

  // Gate 5: Emoji only
  const isEmojiOnly = EMOJI_ONLY.test(sanitized);
  gates.push({
    name: "not_emoji_only",
    passed: !isEmojiOnly,
    reason: isEmojiOnly ? "Contains only emoji" : undefined,
  });

  // Gate 6: Link only
  const isLinkOnly = LINK_ONLY.test(sanitized);
  gates.push({
    name: "not_link_only",
    passed: !isLinkOnly,
    reason: isLinkOnly ? "Contains only links" : undefined,
  });

  // Gate 7: Mention only
  const isMentionOnly = MENTION_ONLY.test(sanitized);
  gates.push({
    name: "not_mention_only",
    passed: !isMentionOnly,
    reason: isMentionOnly ? "Contains only mentions" : undefined,
  });

  return {
    messageId: msg.id,
    passed: gates.every((g) => g.passed),
    gates,
  };
}

export function isValidMessageForThread(msg: DiscordMessage): boolean {
  return evaluateMessageGates(msg).passed;
}

// AI naming
export async function generateAIThreadName(
  targetMsg: DiscordMessage,
  contextMessages: DiscordMessage[],
): Promise<AIThreadResult | null> {
  try {
    const openai = new OpenAI();

    const MAX_CONTEXT_CHARS = 3500;
    let contextStr = "";

    for (const msg of contextMessages) {
      const line = `[${msg.author.username}]: ${sanitizeContent(msg.content)}\n`;
      if (contextStr.length + line.length > MAX_CONTEXT_CHARS) break;
      contextStr += line;
    }

    const targetLine = `>>> [${targetMsg.author.username}]: ${sanitizeContent(targetMsg.content)}`;

    const prompt = `You are helping create a Discord thread. Based on the conversation context and the target message (marked with >>>), generate:
1. A concise thread name (max 100 chars, no quotes, no newlines)
2. A brief summary (2-4 bullet points) to post as the first message

Context:
${contextStr}
Target message to create thread from:
${targetLine}

Return ONLY valid JSON, no markdown, no code fences:
{"thread_name": "...", "summary": "• Point 1\\n• Point 2\\n• Point 3"}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    });

    const responseText = completion.choices[0]?.message?.content?.trim();
    if (!responseText) {
      console.warn(`⚠️ [Autothread:AI] Empty response from OpenAI`);
      return null;
    }

    let jsonStr = responseText;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1];
    }
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      jsonStr = braceMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    const threadName = sanitizeContent(String(parsed.thread_name || "")).slice(
      0,
      100,
    );
    if (!threadName) {
      console.warn(`⚠️ [Autothread:AI] Empty thread_name after sanitization`);
      return null;
    }

    let summary: string | null = null;
    if (parsed.summary) {
      const rawSummary = String(parsed.summary).trim();
      if (rawSummary.length > 0) {
        summary =
          rawSummary.length > 2000 ? rawSummary.slice(0, 1997) + "..." : rawSummary;
      }
    }

    console.log(`🤖 [Autothread:AI] Generated name: "${threadName}"`);
    return { threadName, summary };
  } catch (err) {
    console.error(
      `❌ [Autothread:AI] Failed to generate AI name:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function gatherContextMessages(
  allMessages: DiscordMessage[],
  targetMsgId: string,
  maxBefore = 4,
): DiscordMessage[] {
  const targetIndex = allMessages.findIndex((m) => m.id === targetMsgId);
  if (targetIndex === -1) return [];
  const startIndex = Math.max(0, targetIndex - maxBefore);
  return allMessages.slice(startIndex, targetIndex);
}

// Event helper
function createEvent(
  level: RunEvent["level"],
  event: string,
  channelId?: string,
  messageId?: string,
  details?: Record<string, unknown>,
): RunEvent {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    channelId,
    messageId,
    details,
  };
}

// Main processing function
export async function processChannel(
  channel: DiscordChannel,
  discord: DiscordService,
  store: AutothreadStore,
  config: AutothreadConfig,
  ctx: RunContext,
): Promise<{ threadsCreated: number; actions: PlannedAction[] }> {
  const actions: PlannedAction[] = [];
  const lastMessageId = await store.getLastMessageId(channel.id);

  // Fetch messages using backward pagination
  const allMessages: DiscordMessage[] = [];
  let before: string | undefined = undefined;
  const MAX_PAGES = 3;

  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await discord.getMessages(channel.id, { before, limit: 100 });
    if (batch.length === 0) break;

    allMessages.push(...batch);
    const oldestInBatch = batch[batch.length - 1]!.id;

    if (lastMessageId && BigInt(oldestInBatch) <= BigInt(lastMessageId)) {
      break;
    }
    before = oldestInBatch;
  }

  // Sort oldest-first
  allMessages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

  // Filter to new messages
  const newMessages = lastMessageId
    ? allMessages.filter((m) => BigInt(m.id) > BigInt(lastMessageId))
    : allMessages;

  ctx.events.push(
    createEvent("debug", "channel_scanned", channel.id, undefined, {
      totalMessages: allMessages.length,
      newMessages: newMessages.length,
      lastMessageId,
    }),
  );

  if (newMessages.length === 0) {
    if (config.mode !== "plan") {
      await store.updateChannelState(channel.id, channel.name, channel.topic ?? null);
    }
    return { threadsCreated: 0, actions };
  }

  // Check cooldown
  const isQuietMode = hasQuietMode(channel.topic);
  const onCooldown = await store.isChannelOnCooldown(
    channel.id,
    COOLDOWN_WINDOW_MS,
    MAX_THREADS_PER_CHANNEL_PER_WINDOW,
  );

  if (onCooldown) {
    ctx.events.push(
      createEvent("info", "channel_on_cooldown", channel.id),
    );
    actions.push({
      type: "cooldown",
      channelId: channel.id,
      channelName: channel.name,
      reason: `Cooldown: ${MAX_THREADS_PER_CHANNEL_PER_WINDOW} threads in ${COOLDOWN_WINDOW_MS / 60000} min`,
    });
    if (config.mode !== "plan") {
      await store.updateChannelState(channel.id, channel.name, channel.topic ?? null);
    }
    return { threadsCreated: 0, actions };
  }

  let threadsCreated = 0;
  let safelyProcessedUpTo = lastMessageId;

  for (const msg of newMessages) {
    if (ctx.threadsCreatedThisRun + threadsCreated >= config.maxThreadsPerRun) {
      ctx.events.push(createEvent("warn", "thread_cap_reached"));
      break;
    }

    const gateEval = evaluateMessageGates(msg);
    if (!gateEval.passed) {
      const failedGate = gateEval.gates.find((g) => !g.passed);
      actions.push({
        type: "skip",
        channelId: channel.id,
        channelName: channel.name,
        messageId: msg.id,
        reason: failedGate?.reason ?? "Failed gate evaluation",
      });

      if (config.mode !== "plan") {
        await store.tryClaimMessage(channel.id, msg.id, "skipped");
        safelyProcessedUpTo = msg.id;
      }
      continue;
    }

    // In plan mode, just record what would happen
    if (config.mode === "plan") {
      const contextMsgs = config.enableAI
        ? gatherContextMessages(allMessages, msg.id, 4)
        : [];
      let threadName = generateThreadName(msg);
      let wouldPostSummary = false;

      if (config.enableAI) {
        const aiResult = await generateAIThreadName(msg, contextMsgs);
        if (aiResult) {
          threadName = aiResult.threadName;
          wouldPostSummary = !!aiResult.summary && !isQuietMode;
        }
      }

      actions.push({
        type: "create_thread",
        channelId: channel.id,
        channelName: channel.name,
        messageId: msg.id,
        threadName,
        wouldPostSummary,
      });

      ctx.events.push(
        createEvent("info", "would_create_thread", channel.id, msg.id, {
          threadName,
          wouldPostSummary,
        }),
      );

      threadsCreated++;
      continue;
    }

    // Try to claim message
    const claimStatus = config.mode === "dry_run" ? "dry_run" : "processing";
    const claimed = await store.tryClaimMessage(channel.id, msg.id, claimStatus);

    if (!claimed) {
      safelyProcessedUpTo = msg.id;
      continue;
    }

    // Generate thread name
    const contextMsgs = config.enableAI
      ? gatherContextMessages(allMessages, msg.id, 4)
      : [];
    let threadName = generateThreadName(msg);
    let summary: string | null = null;

    if (config.enableAI) {
      const aiResult = await generateAIThreadName(msg, contextMsgs);
      if (aiResult) {
        threadName = aiResult.threadName;
        summary = aiResult.summary;
      }
    }

    // Dry-run: log but don't create thread
    if (config.mode === "dry_run") {
      ctx.events.push(
        createEvent("info", "dry_run_thread", channel.id, msg.id, {
          threadName,
          hasSummary: !!summary,
        }),
      );
      actions.push({
        type: "create_thread",
        channelId: channel.id,
        channelName: channel.name,
        messageId: msg.id,
        threadName,
        wouldPostSummary: !!summary && !isQuietMode,
      });
      threadsCreated++;
      safelyProcessedUpTo = msg.id;
      continue;
    }

    // Live mode: actually create thread
    try {
      const thread = await discord.startThreadFromMessage(
        channel.id,
        msg.id,
        threadName,
      );

      if (summary && !isQuietMode) {
        try {
          await discord.sendMessage(thread.id, summary);
        } catch (summaryErr) {
          console.warn(
            `⚠️ [Autothread] Failed to post summary:`,
            summaryErr instanceof Error ? summaryErr.message : summaryErr,
          );
        }
      }

      await store.updateMessageStatus(channel.id, msg.id, "created", thread.id);
      await store.recordThreadCreated(channel.id);

      ctx.events.push(
        createEvent("info", "thread_created", channel.id, msg.id, {
          threadId: thread.id,
          threadName,
        }),
      );

      actions.push({
        type: "create_thread",
        channelId: channel.id,
        channelName: channel.name,
        messageId: msg.id,
        threadName,
      });

      threadsCreated++;
      safelyProcessedUpTo = msg.id;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Discord 160004: thread already exists for this message — treat as success
      if (isThreadAlreadyExistsError(err)) {
        console.log(
          `ℹ️ [Autothread] Thread already exists for message ${msg.id} in #${channel.name}, marking as created`,
        );
        await store.updateMessageStatus(channel.id, msg.id, "created", undefined);
        ctx.events.push(
          createEvent("info", "thread_already_exists", channel.id, msg.id),
        );
        safelyProcessedUpTo = msg.id;
        continue;
      }

      ctx.errorsThisRun++;
      ctx.lastError = errorMsg;

      await store.updateMessageStatus(channel.id, msg.id, "error", undefined, errorMsg);

      ctx.events.push(
        createEvent("error", "thread_creation_failed", channel.id, msg.id, {
          error: errorMsg,
        }),
      );

      actions.push({
        type: "error",
        channelId: channel.id,
        channelName: channel.name,
        messageId: msg.id,
        reason: errorMsg,
      });

      safelyProcessedUpTo = msg.id;
    }
  }

  // Update cursor
  if (config.mode !== "plan" && safelyProcessedUpTo) {
    await store.updateChannelState(
      channel.id,
      channel.name,
      channel.topic ?? null,
      safelyProcessedUpTo,
    );
  }

  return { threadsCreated, actions };
}

// Poll and process all channels
export async function pollAndProcessMessages(
  discord: DiscordService,
  store: AutothreadStore,
  config: AutothreadConfig,
  ctx: RunContext,
): Promise<PlannedAction[]> {
  const allChannels = await discord.listGuildChannels();
  const textChannels = allChannels.filter((ch) => ch.type === 0);

  let autothreadChannels = textChannels.filter(
    (ch) => hasAutothreadTag(ch.topic),
  );

  if (autothreadChannels.length === 0) {
    console.log(
      `ℹ️ [Autothread] No channels with [autothread] tag found. Checked ${textChannels.length} text channels. ` +
      `Add "[autothread]" to a channel's topic to enable. Sample topics: ${textChannels.slice(0, 5).map((ch) => `#${ch.name}: "${ch.topic ?? "(empty)"}"`).join(", ")}`,
    );
    ctx.events.push(
      createEvent("info", "no_autothread_channels", undefined, undefined, {
        textChannelCount: textChannels.length,
        sampleChannels: textChannels.slice(0, 5).map((c) => ({
          id: c.id,
          name: c.name,
          topic: c.topic ?? null,
        })),
      }),
    );
    return [];
  }

  if (config.channelAllowlist) {
    const beforeAllowlist = autothreadChannels.length;
    autothreadChannels = autothreadChannels.filter((ch) =>
      config.channelAllowlist!.includes(ch.id),
    );
    if (autothreadChannels.length === 0 && beforeAllowlist > 0) {
      console.warn(
        `⚠️ [Autothread] ${beforeAllowlist} channels have [autothread] tag but none match the allowlist: ${config.channelAllowlist.join(",")}`,
      );
    }
  }

  autothreadChannels = autothreadChannels.slice(0, config.maxChannelsPerRun);

  ctx.events.push(
    createEvent("info", "poll_started", undefined, undefined, {
      channelCount: autothreadChannels.length,
      channels: autothreadChannels.map((c) => ({ id: c.id, name: c.name, topic: c.topic })),
    }),
  );

  console.log(
    `🔍 [Autothread] Found ${autothreadChannels.length} autothread channel(s): ${autothreadChannels.map((c) => `#${c.name}`).join(", ")}`,
  );

  if (autothreadChannels.length === 0) {
    return [];
  }

  const allActions: PlannedAction[] = [];

  for (const channel of autothreadChannels) {
    if (ctx.threadsCreatedThisRun >= config.maxThreadsPerRun) {
      break;
    }

    try {
      const { threadsCreated, actions } = await processChannel(
        channel,
        discord,
        store,
        config,
        ctx,
      );
      ctx.threadsCreatedThisRun += threadsCreated;
      allActions.push(...actions);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      ctx.errorsThisRun++;
      ctx.lastError = errorMsg;
      ctx.events.push(
        createEvent("error", "channel_processing_failed", channel.id, undefined, {
          error: errorMsg,
        }),
      );
    }
  }

  return allActions;
}
