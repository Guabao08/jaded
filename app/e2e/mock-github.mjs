// A fake GitHub OAuth server for end-to-end tests. The app is pointed at it
// with AUTH_GITHUB_BASE_URL, which env validation allows only on loopback.
//   POST /__next-user {"id":1001,"login":"alice"}  chooses who "signs in" next
//   GET  /login/oauth/authorize                     redirects straight back with a code
//   POST /login/oauth/access_token                  returns a fake token
//   GET  /api/v3/user                               returns the profile for that token
import { createServer } from "node:http";

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

  if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
    const code = new URLSearchParams(await readBody(req)).get("code");
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
