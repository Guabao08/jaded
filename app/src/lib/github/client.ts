import { createSign } from "node:crypto";
import type { Env, GitHubAppEnv } from "../env";

/**
 * Minimal GitHub App client. Installation tokens are minted per task with the
 * narrowest permissions, used, and dropped: they are never stored.
 */

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

// Read-only permissions Jaded needs from an installation (see SECURITY.md).
export const INSTALLATION_PERMISSIONS = { metadata: "read", contents: "read", pull_requests: "read" } as const;

export interface GitHubUrls {
  web: string;
  api: string;
}

export function githubUrls(env: Pick<Env, "GITHUB_TEST_BASE_URL">): GitHubUrls {
  const base = env.GITHUB_TEST_BASE_URL?.replace(/\/$/, "");
  return base ? { web: base, api: `${base}/api/v3` } : { web: "https://github.com", api: "https://api.github.com" };
}

/** A short-lived JWT that authenticates as the App itself (RS256, 9 minutes). */
export function appJwt(app: Pick<GitHubAppEnv, "appId" | "privateKey">, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60; // allow for clock drift
  const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat, exp: iat + 600, iss: app.appId })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(app.privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

export interface GitHubClient {
  getInstallation(installationId: string): Promise<{ id: number; account: { login: string; type: string } }>;
  installationToken(installationId: string, repositoryIds?: number[]): Promise<string>;
  listInstallationRepos(
    token: string,
  ): Promise<Array<{ id: number; full_name: string; private: boolean; default_branch: string }>>;
  getRepo(
    token: string,
    fullName: string,
  ): Promise<{ id: number; full_name: string; private: boolean; default_branch: string }>;
  pullsForCommit(
    token: string,
    fullName: string,
    sha: string,
  ): Promise<Array<{ number: number; title: string; html_url: string; state: string }>>;
  /** Exchanges the code from an installation's user-authorization step for a user token. */
  exchangeUserCode(code: string): Promise<string>;
  userInstallationIds(userToken: string): Promise<string[]>;
  revokeUserToken(userToken: string): Promise<void>;
}

export function createGitHubClient(app: GitHubAppEnv, urls: GitHubUrls, fetchImpl: typeof fetch = fetch): GitHubClient {
  async function call<T>(url: string, init: RequestInit & { token?: string; jwt?: boolean } = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/vnd.github+json");
    headers.set("user-agent", "jaded-app");
    headers.set("x-github-api-version", "2022-11-28");
    if (init.jwt) headers.set("authorization", `Bearer ${appJwt(app)}`);
    else if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const response = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new GitHubError(`GitHub request failed (${response.status})`, response.status);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  return {
    getInstallation: (id) => call(`${urls.api}/app/installations/${encodeURIComponent(id)}`, { jwt: true }),

    async installationToken(id, repositoryIds) {
      const body = {
        permissions: INSTALLATION_PERMISSIONS,
        ...(repositoryIds ? { repository_ids: repositoryIds } : {}),
      };
      const result = await call<{ token: string }>(
        `${urls.api}/app/installations/${encodeURIComponent(id)}/access_tokens`,
        { method: "POST", jwt: true, body: JSON.stringify(body), headers: { "content-type": "application/json" } },
      );
      return result.token;
    },

    async listInstallationRepos(token) {
      const result = await call<{
        repositories: Array<{ id: number; full_name: string; private: boolean; default_branch: string }>;
      }>(`${urls.api}/installation/repositories?per_page=100`, { token });
      return result.repositories;
    },

    getRepo: (token, fullName) =>
      call(`${urls.api}/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`, { token }),

    pullsForCommit: (token, fullName, sha) =>
      call(
        `${urls.api}/repos/${fullName.split("/").map(encodeURIComponent).join("/")}/commits/${encodeURIComponent(sha)}/pulls`,
        { token },
      ),

    async exchangeUserCode(code) {
      const result = await call<{ access_token?: string; error?: string }>(`${urls.web}/login/oauth/access_token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code }),
      });
      if (!result.access_token) throw new GitHubError("GitHub did not return a user token", 400);
      return result.access_token;
    },

    async userInstallationIds(userToken) {
      const result = await call<{ installations: Array<{ id: number }> }>(
        `${urls.api}/user/installations?per_page=100`,
        {
          token: userToken,
        },
      );
      return result.installations.map((i) => String(i.id));
    },

    async revokeUserToken(userToken) {
      const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
      await call(`${urls.api}/applications/${encodeURIComponent(app.clientId)}/token`, {
        method: "DELETE",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/json" },
        body: JSON.stringify({ access_token: userToken }),
      }).catch(() => undefined); // Best effort: the token expires anyway.
    },
  };
}
