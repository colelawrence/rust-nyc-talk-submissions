const DISCORD_CHANNEL_NAME_MAX = 100;
const DISCORD_MESSAGE_MAX = 2000;

// Keep some margin for formatting and future tweaks.
const DISCORD_MESSAGE_CHUNK_TARGET = 1900;

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function truncateText(text: string, maxChars: number): string {
  const normalized = normalizeNewlines(text);
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return "…";
  return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function splitTextIntoChunks(text: string, maxChunkChars: number): string[] {
  const normalized = normalizeNewlines(text);
  if (normalized.length === 0) return [];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxChunkChars) {
    // Prefer splitting on a newline, then on whitespace, otherwise hard-split.
    const window = remaining.slice(0, maxChunkChars + 1);

    let splitAt = window.lastIndexOf("\n");
    if (splitAt < Math.floor(maxChunkChars * 0.6)) {
      splitAt = window.lastIndexOf(" ");
    }
    if (splitAt < Math.floor(maxChunkChars * 0.6)) {
      splitAt = maxChunkChars;
    }

    const chunk = remaining.slice(0, splitAt).trimEnd();
    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();

    // Safety: avoid infinite loops if trimStart() removed nothing.
    if (remaining.length > 0 && chunk.length === 0) {
      chunks.push(remaining.slice(0, maxChunkChars));
      remaining = remaining.slice(maxChunkChars).trimStart();
    }
  }

  if (remaining.length > 0) chunks.push(remaining);

  return chunks;
}

export function submissionInfo(
  isOnBehalf: boolean,
  submitterName?: string,
): string {
  if (isOnBehalf && submitterName) {
    return `Submitted by **${submitterName}** on behalf of the speaker`;
  }
  if (isOnBehalf) {
    return "Submitted by someone else on behalf of the speaker";
  }
  return "Submitted by the speaker themselves";
}

/**
 * Split talk context into one-or-more Discord-safe messages.
 *
 * This prevents failures when users submit a large context block,
 * while keeping the full text available in the channel.
 */
export function talkContextMessages(talkContext: string): string[] {
  const header = "**Talk Context:**\n";

  const maxFirstChunk = Math.max(
    1,
    DISCORD_MESSAGE_CHUNK_TARGET - header.length,
  );

  const chunks: string[] = [];
  const firstChunks = splitTextIntoChunks(talkContext, maxFirstChunk);

  if (firstChunks.length === 0) {
    return [header + "(empty)"];
  }

  chunks.push(header + firstChunks[0]!);

  // Remaining chunks can use the full target.
  const remainingText = firstChunks.slice(1).join("\n").trim();
  if (remainingText.length > 0) {
    const restChunks = splitTextIntoChunks(
      remainingText,
      DISCORD_MESSAGE_CHUNK_TARGET,
    );
    chunks.push(...restChunks);
  }

  // Absolute safety: Discord hard limit is 2000 chars.
  return chunks.map((c) => truncateText(c, DISCORD_MESSAGE_MAX));
}

export function welcomeMessage(params: {
  speakerName: string;
  isOnBehalf: boolean;
  submitterName?: string;
}): string {
  const { speakerName, isOnBehalf, submitterName } = params;

  return `🎤 **Welcome to your talk discussion channel!**

**Speaker:** ${speakerName}
**Submission:** ${submissionInfo(isOnBehalf, submitterName)}

This channel has been created for you to discuss your talk proposal with the organizers. Feel free to share additional details, ask questions, or coordinate next steps here.

Your original talk context is posted below for reference.

The organizers have been notified and will be in touch soon!`;
}

export function organizersNotification(params: {
  speakerName: string;
  talkContext: string;
  isOnBehalf: boolean;
  submitterName?: string;
  channelId: string;
}): string {
  const { speakerName, talkContext, isOnBehalf, submitterName, channelId } =
    params;

  const contextExcerpt = truncateText(talkContext, 800);

  return `🎤 **New Talk Submission**
**Speaker:** ${speakerName}
**Talk Context (excerpt):** ${contextExcerpt}
**Submission Info:** ${submissionInfo(isOnBehalf, submitterName)}
**Discussion Channel:** ${
    channelId.includes("placeholder")
      ? "Channel creation failed"
      : `<#${channelId}>`
  }`;
}

export function testNotification(params: {
  channelName: string;
  firstMessage: string;
  channelId: string;
  inviteLink: string;
}): string {
  const { channelName, firstMessage, channelId, inviteLink } = params;

  return `🧪 **Test Channel Created**
**Channel Name:** ${channelName}
**First Message (excerpt):** ${truncateText(firstMessage, 400)}
**Channel Link:** ${
    channelId.includes("placeholder")
      ? "Channel creation failed"
      : `<#${channelId}>`
  }
**Invitation Link:** ${inviteLink}`;
}

export function testMessage(message: string): string {
  return `🧪 **Test Message**
${message}

*Sent at ${new Date().toISOString()}*`;
}

export function sanitizeChannelName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DISCORD_CHANNEL_NAME_MAX);

  return sanitized || "talk-submission";
}
