import type { DiscordConfig } from "./config.ts";
import { DiscordApiError, safeParseJson } from "./errors.ts";

// Discord API v10 Types
export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  topic?: string | null;
  parent_id?: string | null;
  guild_id?: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  thread?: { id: string; name: string } | null;
}

export interface DiscordThread {
  id: string;
  name: string;
  type: number;
  parent_id: string;
}

export interface DiscordService {
  createChannel(name: string, parentId?: string): Promise<string>;
  createInvite(channelId: string): Promise<string>;
  sendMessage(channelId: string, content: string): Promise<{ id: string }>;
  listGuildChannels(): Promise<DiscordChannel[]>;
  getMessages(
    channelId: string,
    options?: { after?: string; before?: string; limit?: number },
  ): Promise<DiscordMessage[]>;
  startThreadFromMessage(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<DiscordThread>;
}

class RealDiscordService implements DiscordService {
  constructor(private config: DiscordConfig) {}

  private async request<T>(
    path: string,
    init: RequestInit,
    retryCount = 0,
  ): Promise<T> {
    const MAX_RETRIES = 2;
    const url = `https://discord.com/api/v10${path}`;
    console.log(`🚀 [Discord] API request: ${init.method || "GET"} ${path}`);

    const response = await fetch(url, {
      ...init,
      headers: {
        "Authorization": `Bot ${this.config.botToken}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    console.log(
      `📡 [Discord] Response status: ${response.status} ${response.statusText}`,
    );

    // Handle rate limiting (429)
    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const parsed = safeParseJson(text);
      const retryAfter =
        parsed && typeof parsed === "object" && "retry_after" in parsed
          ? Number(parsed.retry_after)
          : 1;
      console.warn(
        `⏳ [Discord] Rate limited, retrying after ${retryAfter}s (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfter * 1000 + 100)
      );
      return this.request<T>(path, init, retryCount + 1);
    }

    if (!response.ok) {
      const errorData = safeParseJson(text);
      console.error(
        `❌ [Discord] API error:`,
        JSON.stringify(errorData, null, 2),
      );
      throw new DiscordApiError(response.status, errorData);
    }

    const data = safeParseJson(text);
    return data as T;
  }

  async createChannel(name: string, parentId?: string): Promise<string> {
    console.log(
      `🔧 [Discord] Creating channel: "${name}"${
        parentId ? ` in category ${parentId}` : ""
      }`,
    );

    const body: any = {
      name,
      type: 0,
    };

    if (parentId) {
      body.parent_id = parentId;
    }

    const channel = await this.request<{ id: string; name: string }>(
      `/guilds/${this.config.guildId}/channels`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    console.log(`✅ [Discord] Channel created: ${channel.id} (${channel.name})`);
    return channel.id;
  }

  async createInvite(channelId: string): Promise<string> {
    console.log(`🔗 [Discord] Creating invite for channel: ${channelId}`);

    const invite = await this.request<{ code: string }>(
      `/channels/${channelId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({
          max_age: this.config.inviteMaxAge,
          max_uses: 0,
          unique: true,
        }),
      },
    );

    const inviteUrl = `https://discord.gg/${invite.code}`;
    console.log(`✅ [Discord] Invite created (code redacted for security)`);
    return inviteUrl;
  }

  async sendMessage(
    channelId: string,
    content: string,
  ): Promise<{ id: string }> {
    // Discord hard limit: 2000 characters in message content.
    // Truncate defensively so user-provided talk context cannot cause a hard failure.
    const DISCORD_MESSAGE_MAX = 2000;

    let safeContent = content;
    if (safeContent.length > DISCORD_MESSAGE_MAX) {
      console.warn(
        `⚠️ [Discord] Message content too long (${safeContent.length}), truncating to ${DISCORD_MESSAGE_MAX} chars`,
      );
      safeContent = safeContent.slice(0, DISCORD_MESSAGE_MAX - 1) + "…";
    }

    console.log(
      `💬 [Discord] Sending message to channel: ${channelId} (${safeContent.length} chars)`,
    );

    const message = await this.request<{ id: string; timestamp: string }>(
      `/channels/${channelId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: safeContent,
          // Prevent user-provided text from pinging @everyone / roles / users.
          allowed_mentions: { parse: [] },
        }),
      },
    );

    console.log(`✅ [Discord] Message sent: ${message.id}`);
    return { id: message.id };
  }

  async listGuildChannels(): Promise<DiscordChannel[]> {
    console.log(`📋 [Discord] Listing channels for guild: ${this.config.guildId}`);

    const channels = await this.request<DiscordChannel[]>(
      `/guilds/${this.config.guildId}/channels`,
      { method: "GET" },
    );

    console.log(`✅ [Discord] Found ${channels.length} channels`);
    return channels;
  }

  async getMessages(
    channelId: string,
    options?: { after?: string; before?: string; limit?: number },
  ): Promise<DiscordMessage[]> {
    // Discord limit: 1-100, default 50
    const limit = Math.min(100, Math.max(1, options?.limit ?? 50));
    const params = new URLSearchParams({ limit: String(limit) });
    if (options?.after) {
      params.set("after", options.after);
    }
    if (options?.before) {
      params.set("before", options.before);
    }

    console.log(
      `📨 [Discord] Fetching messages from ${channelId} (limit=${limit}${options?.after ? `, after=${options.after}` : ""}${options?.before ? `, before=${options.before}` : ""})`,
    );

    const messages = await this.request<DiscordMessage[]>(
      `/channels/${channelId}/messages?${params}`,
      { method: "GET" },
    );

    console.log(`✅ [Discord] Fetched ${messages.length} messages`);
    return messages;
  }

  async startThreadFromMessage(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<DiscordThread> {
    // Discord thread names are limited to 100 characters
    const threadName = name.slice(0, 100);
    console.log(
      `🧵 [Discord] Creating thread from message ${messageId}: "${threadName}"`,
    );

    const thread = await this.request<DiscordThread>(
      `/channels/${channelId}/messages/${messageId}/threads`,
      {
        method: "POST",
        body: JSON.stringify({
          name: threadName,
          auto_archive_duration: 1440, // 24 hours — explicit to avoid server-default surprises
        }),
      },
    );

    console.log(`✅ [Discord] Thread created: ${thread.id} (${thread.name})`);
    return thread;
  }
}

class NoopDiscordService implements DiscordService {
  createChannel(name: string, parentId?: string): Promise<string> {
    const id = `placeholder-${crypto.randomUUID()}`;
    console.log(
      `🔄 [Discord:NOOP] Would create channel: "${name}"${
        parentId ? ` in category ${parentId}` : ""
      } → ${id}`,
    );
    return Promise.resolve(id);
  }

  createInvite(channelId: string): Promise<string> {
    const invite = `https://discord.gg/placeholder-${channelId}`;
    console.log(
      `🔄 [Discord:NOOP] Would create invite for ${channelId} → ${invite}`,
    );
    return Promise.resolve(invite);
  }

  sendMessage(
    channelId: string,
    content: string,
  ): Promise<{ id: string }> {
    const id = `msg-${Date.now()}`;
    console.log(`🔄 [Discord:NOOP] Would send message to ${channelId}:`);
    console.log(content);
    console.log(`🔄 [Discord:NOOP] Message ID would be: ${id}`);
    return Promise.resolve({ id });
  }

  listGuildChannels(): Promise<DiscordChannel[]> {
    console.log(`🔄 [Discord:NOOP] Would list guild channels`);
    return Promise.resolve([
      {
        id: "noop-channel-1",
        name: "general",
        type: 0,
        topic: "General discussion [autothread]",
      },
    ]);
  }

  getMessages(
    channelId: string,
    options?: { after?: string; before?: string; limit?: number },
  ): Promise<DiscordMessage[]> {
    console.log(
      `🔄 [Discord:NOOP] Would fetch messages from ${channelId} (after=${options?.after}, before=${options?.before}, limit=${options?.limit})`,
    );
    return Promise.resolve([]);
  }

  startThreadFromMessage(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<DiscordThread> {
    const threadId = `thread-${Date.now()}`;
    console.log(
      `🔄 [Discord:NOOP] Would create thread from message ${messageId}: "${name}" → ${threadId}`,
    );
    return Promise.resolve({
      id: threadId,
      name: name.slice(0, 100),
      type: 11, // Public thread
      parent_id: channelId,
    });
  }
}

export function makeDiscordService(
  config?: DiscordConfig,
): DiscordService {
  if (config) {
    return new RealDiscordService(config);
  }
  return new NoopDiscordService();
}
