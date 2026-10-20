// A fake GitHub OAuth server for end-to-end tests. The app is pointed at it
// with GITHUB_TEST_BASE_URL, which env validation allows only on loopback.
//   POST /__next-user {"id":1001,"login":"alice"}  chooses who "signs in" next
//   GET  /login/oauth/authorize                     redirects straight back with a code
//   POST /login/oauth/access_token                  returns a fake token
//   GET  /api/v3/user                               returns the profile for that token
// GitHub App endpoints (installation 5001 on alice's account, repo alice/demo):
//   GET  /apps/:slug/installations/new             redirects to the app's install callback
//   /api/v3/app/...                                 checks the app JWT against MOCK_APP_PUBLIC_KEY
import { createVerify } from "node:crypto";
import { createServer } from "node:http";

const appPublicKey = Buffer.from(process.env.MOCK_APP_PUBLIC_KEY ?? "", "base64").toString("utf8");
const appCallback = process.env.MOCK_APP_CALLBACK ?? "";
const INSTALLATION = { id: 5001, account: { login: "alice", type: "User" }, owner: 1001 };
const REPO = { id: 777, full_name: "alice/demo", private: false, default_branch: "main" };

function validAppJwt(req) {
  const jwt = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s || !appPublicKey) return false;
  const signed = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(appPublicKey, Buffer.from(s, "base64url"));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return signed && claims.exp > Date.now() / 1000;
}

const port = Number(process.env.MOCK_GITHUB_PORT ?? 3101);
let nextUser = { id: 1001, login: "alice", name: "Alice" };
const users = new Map(); // code or token -> profile

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });

  if (req.method === "POST" && url.pathname === "/__next-user") {
    nextUser = JSON.parse(await readBody(req));
    return json(res, 200, nextUser);
  }

  if (req.method === "GET" && url.pathname === "/login/oauth/authorize") {
    const code = `code-${nextUser.id}-${Date.now()}`;
    users.set(code, nextUser);
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }

  if (req.method === "GET" && /^\/apps\/[a-z0-9-]+\/installations\/new$/.test(url.pathname)) {
    const code = `appcode-${nextUser.id}-${Date.now()}`;
    users.set(code, nextUser);
    const back = new URL(appCallback);
    back.searchParams.set("code", code);
    back.searchParams.set("installation_id", String(INSTALLATION.id));
    back.searchParams.set("setup_action", "install");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/api/v3/user/installations") {
    const user = users.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!user) return json(res, 401, { message: "Bad credentials" });
    return json(res, 200, { installations: user.id === INSTALLATION.owner ? [{ id: INSTALLATION.id }] : [] });
  }

  if (url.pathname.startsWith("/api/v3/app/")) {
    if (!validAppJwt(req)) return json(res, 401, { message: "A JSON web token could not be decoded" });
    if (req.method === "GET" && url.pathname === `/api/v3/app/installations/${INSTALLATION.id}`) {
      return json(res, 200, { id: INSTALLATION.id, account: INSTALLATION.account });
    }
    if (req.method === "POST" && url.pathname === `/api/v3/app/installations/${INSTALLATION.id}/access_tokens`) {
      const body = JSON.parse((await readBody(req)) || "{}");
      const readOnly = Object.values(body.permissions ?? {}).every((p) => p === "read");
      if (!readOnly) return json(res, 422, { message: "Only read permissions are expected" });
      return json(res, 201, {
        token: "ghs_mock_installation",
        expires_at: new Date(Date.now() + 3600e3).toISOString(),
      });
    }
    return json(res, 404, { message: "Not Found" });
  }

  if (req.method === "GET" && url.pathname === "/api/v3/installation/repositories") {
    if (req.headers.authorization !== "Bearer ghs_mock_installation")
      return json(res, 401, { message: "Bad credentials" });
    return json(res, 200, { total_count: 1, repositories: [REPO] });
  }

  if (req.method === "GET" && /^\/api\/v3\/repos\/alice\/demo\/commits\/[0-9a-f]+\/pulls$/.test(url.pathname)) {
    if (req.headers.authorization !== "Bearer ghs_mock_installation")
      return json(res, 401, { message: "Bad credentials" });
    return json(res, 200, [
      { number: 12, title: "Dark mode", html_url: "https://github.com/alice/demo/pull/12", state: "closed" },
    ]);
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/v3/applications/")) {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
    const raw = await readBody(req);
    const code = raw.trim().startsWith("{") ? JSON.parse(raw).code : new URLSearchParams(raw).get("code");
    const user = users.get(code);
    if (!user) return json(res, 400, { error: "bad_verification_code" });
    users.delete(code);
    const token = `fake-token-${user.id}-${Date.now()}`;
    users.set(token, user);
    return json(res, 200, { access_token: token, token_type: "bearer", scope: "" });
  }

  if (req.method === "GET" && url.pathname === "/api/v3/user") {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const user = users.get(token);
    if (!user) return json(res, 401, { message: "Bad credentials" });
    return json(res, 200, { id: user.id, login: user.login, name: user.name ?? null, avatar_url: null, email: null });
  }

  if (req.method === "GET" && url.pathname === "/api/v3/user/emails") return json(res, 404, { message: "Not Found" });

  json(res, 404, { message: "Not Found" });
}).listen(port, "127.0.0.1");
