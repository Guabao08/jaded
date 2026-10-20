import { env, githubAppEnv } from "../env";
import { createGitHubClient, githubUrls, type GitHubClient } from "./client";

/** The GitHub App client, or null while the App is not configured. */
export function github(): { client: GitHubClient; slug: string; webUrl: string } | null {
  const e = env();
  const app = githubAppEnv(e);
  if (!app) return null;
  const urls = githubUrls(e);
  return { client: createGitHubClient(app, urls), slug: app.slug, webUrl: urls.web };
}
