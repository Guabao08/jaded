import { z } from "zod";

/** What a text provider is given to write posts from. Fields marked untrusted come from other people. */
export interface PostWritingInput {
  app: {
    name: string;
    category: string | null;
    // Untrusted when it was imported from a store listing and not yet saved by the user.
    description: string;
    descriptionTrusted: boolean;
  };
  voice: { tone: string | null; audience: string | null; wordsToAvoid: string[] };
  // Untrusted: written by whoever pushed the commits / opened the PRs.
  change: {
    repository: string;
    commits: Array<{ title: string; message: string }>;
    pullRequests: Array<{ title: string }>;
  };
  platforms: Array<"INSTAGRAM" | "FACEBOOK">;
}

export const HASHTAG = /^[A-Za-z0-9_]{1,40}$/;

export const generatedPostSchema = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK"]),
  headline: z.string().trim().min(1).max(70),
  caption: z.string().trim().min(1).max(2000),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .transform((t) => t.replace(/^#/, ""))
        .pipe(z.string().regex(HASHTAG)),
    )
    .max(10),
  altText: z.string().trim().min(1).max(300),
});

export const generatedPostsSchema = z.object({
  highlights: z.array(z.string().trim().min(1).max(90)).max(3),
  posts: z.array(generatedPostSchema).min(1),
});

export type GeneratedPosts = z.infer<typeof generatedPostsSchema>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextResult {
  provider: string;
  model: string;
  /** The model's raw reply, validated by the caller. */
  raw: unknown;
  usage: TokenUsage;
}

export interface TextProvider {
  readonly name: string;
  readonly model: string;
  writePosts(prompt: { system: string; user: string }, input: PostWritingInput): Promise<TextResult>;
}

/** The provider's rate limit or quota was hit; try again after `retryAfterSeconds`. */
export class RateLimitedError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    readonly daily: boolean,
  ) {
    super(daily ? "AI daily quota used up" : "AI rate limit reached");
    this.name = "RateLimitedError";
  }
}

/** The provider is not set up (no key) or rejected our credentials. */
export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

/** A temporary provider failure (5xx, timeout) worth retrying soon. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}
