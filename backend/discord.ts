import type { DiscordConfig } from "./config.ts";
import { DiscordApiError, safeParseJson } from "./errors.ts";

export interface DiscordService {
  createChannel(name: string, parentId?: string): Promise<string>;
  createInvite(channelId: string): Promise<string>;
  sendMessage(channelId: string, content: string): Promise<{ id: string }>;
}

class RealDiscordService implements DiscordService {
  constructor(private config: DiscordConfig) {}

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
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
          max_age: 0,
          max_uses: 0,
          unique: true,
        }),
      },
    );

    const inviteUrl = `https://discord.gg/${invite.code}`;
    console.log(`✅ [Discord] Invite created: ${inviteUrl}`);
    return inviteUrl;
  }

  async sendMessage(
    channelId: string,
    content: string,
  ): Promise<{ id: string }> {
    console.log(
      `💬 [Discord] Sending message to channel: ${channelId} (${content.length} chars)`,
    );

    const message = await this.request<{ id: string; timestamp: string }>(
      `/channels/${channelId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    );

    console.log(`✅ [Discord] Message sent: ${message.id}`);
    return { id: message.id };
  }
}

class NoopDiscordService implements DiscordService {
  async createChannel(name: string, parentId?: string): Promise<string> {
    const id = `placeholder-${crypto.randomUUID()}`;
    console.log(
      `🔄 [Discord:NOOP] Would create channel: "${name}"${
        parentId ? ` in category ${parentId}` : ""
      } → ${id}`,
    );
    return id;
  }

  async createInvite(channelId: string): Promise<string> {
    const invite = `https://discord.gg/placeholder-${channelId}`;
    console.log(
      `🔄 [Discord:NOOP] Would create invite for ${channelId} → ${invite}`,
    );
    return invite;
  }

  async sendMessage(
    channelId: string,
    content: string,
  ): Promise<{ id: string }> {
    const id = `msg-${Date.now()}`;
    console.log(`🔄 [Discord:NOOP] Would send message to ${channelId}:`);
    console.log(content);
    console.log(`🔄 [Discord:NOOP] Message ID would be: ${id}`);
    return { id };
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
