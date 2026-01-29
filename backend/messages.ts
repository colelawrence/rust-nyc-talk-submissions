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

export function welcomeMessage(params: {
  speakerName: string;
  talkContext: string;
  isOnBehalf: boolean;
  submitterName?: string;
}): string {
  const { speakerName, talkContext, isOnBehalf, submitterName } = params;

  return `🎤 **Welcome to your talk discussion channel!**

**Speaker:** ${speakerName}
**Talk Context:** ${talkContext}
**Submission:** ${submissionInfo(isOnBehalf, submitterName)}

This channel has been created for you to discuss your talk proposal with the organizers. Feel free to share additional details, ask questions, or coordinate next steps here.

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

  return `🎤 **New Talk Submission**
**Speaker:** ${speakerName}
**Talk Context:** ${talkContext}
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
**First Message:** ${firstMessage}
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
  return name.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 100);
}
