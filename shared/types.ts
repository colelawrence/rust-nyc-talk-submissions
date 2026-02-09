export interface TalkSubmission {
  id: number;
  speaker_name: string;
  talk_context: string;
  is_on_behalf: boolean;
  submitter_name?: string;
  discord_channel_id?: string;
  discord_invite_link?: string;
  created_at: string;
}

export interface SubmissionRequest {
  speakerName: string;
  talkContext: string;
  isOnBehalf: boolean;
  submitterName?: string;
  email?: string;
}

export interface SubmissionResponse {
  success: boolean;
  submissionId: number;
  discordInviteLink: string;
}

export interface DiscordConfig {
  botToken: string;
  guildId: string;
  organizersChannelId: string;
  categoryId?: string;
}

export interface SubmissionsResponse {
  data: TalkSubmission[];
  total: number;
  limit: number;
  offset: number;
}
