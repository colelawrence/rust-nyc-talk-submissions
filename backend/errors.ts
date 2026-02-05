export class DiscordApiError extends Error {
  constructor(
    public status: number,
    public discordError?: { code?: number; message?: string },
  ) {
    super(
      `Discord API error: ${status}${
        discordError?.code ? ` (code ${discordError.code})` : ""
      }`,
    );
    this.name = "DiscordApiError";
  }

  getHint(): string | undefined {
    if (!this.discordError?.code) return undefined;

    const hints: Record<number, string> = {
      50001: "Missing access to channel - check bot permissions",
      10003: "Channel not found - check channel ID",
      50013: "Missing permissions to perform this action",
      10004: "Guild not found - check guild ID",
      50035: "Invalid form body - check request data",
      160004: "A thread has already been created for this message",
    };

    return hints[this.discordError.code];
  }
}

export function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Check if a Discord error means "thread already exists for this message" */
export function isThreadAlreadyExistsError(error: unknown): boolean {
  return error instanceof DiscordApiError && error.discordError?.code === 160004;
}

export function logError(scope: string, error: unknown): void {
  console.error(`💥 [${scope}] Error:`, error);

  if (error instanceof DiscordApiError) {
    console.error(`💥 [${scope}] Status: ${error.status}`);
    if (error.discordError?.code) {
      console.error(`💥 [${scope}] Discord code: ${error.discordError.code}`);
    }
    const hint = error.getHint();
    if (hint) {
      console.error(`💡 [${scope}] Hint: ${hint}`);
    }
  } else if (error instanceof Error) {
    console.error(`💥 [${scope}] Type: ${error.constructor.name}`);
    console.error(`💥 [${scope}] Message: ${error.message}`);
    if (error.stack) {
      console.error(
        `💥 [${scope}] Stack: ${error.stack.split("\n").slice(0, 5).join("\n")}`,
      );
    }
  }
}

export async function safe<T>(
  label: string,
  promise: Promise<T>,
  options: { swallow: boolean },
): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    logError(label, error);
    if (options.swallow) {
      console.log(`🔄 [${label}] Continuing despite error`);
      return undefined;
    }
    throw error;
  }
}
