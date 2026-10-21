import type { PostWritingInput, TextProvider, TextResult } from "./types";

/**
 * A deterministic stand-in for tests, CI and local runs without a key. It
 * writes plain posts from the commit titles and never calls the network.
 * Env validation only allows it with a loopback APP_URL.
 */
export function createFakeProvider(): TextProvider {
  return {
    name: "fake",
    model: "fake-writer-1",
    async writePosts(_prompt, input: PostWritingInput): Promise<TextResult> {
      // Like a sensible writer, lead with a feature or fix; otherwise the latest change.
      const feature = input.change.commits.find((c) => /^(feat|feature|fix|perf)(\(.+?\))?!?:/i.test(c.title));
      const titles = input.change.commits.map((c) => cleanTitle(c.title)).filter(Boolean);
      const main = (feature ? cleanTitle(feature.title) : titles[titles.length - 1]) || "Improvements";
      const name = input.app.name;
      const tag = name.replace(/[^A-Za-z0-9]/g, "") || "App";
      const raw = {
        highlights: [main.slice(0, 80)],
        posts: input.platforms.map((platform) => ({
          platform,
          headline: `${main}`.slice(0, 60),
          caption:
            platform === "INSTAGRAM"
              ? `New in ${name}: ${main}. Update the app to try it.`
              : `${name} update: ${main}. Update the app to try it.`,
          hashtags: platform === "INSTAGRAM" ? [tag, "AppUpdate", "NewFeature"] : [tag],
          altText: `${name} app icon with the headline "${main.slice(0, 60)}".`,
        })),
      };
      return { provider: "fake", model: "fake-writer-1", raw, usage: { inputTokens: 900, outputTokens: 300 } };
    },
  };
}

function cleanTitle(title: string): string {
  return title
    .replace(/^[a-z]+(\(.+?\))?!?:\s*/i, "") // conventional-commit prefix
    .replace(/[^\p{L}\p{N} .,'!?-]/gu, "")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}
