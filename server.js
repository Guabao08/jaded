import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(projectRoot, 'public');
const dataFile = path.resolve(process.env.SHIPBRIEF_DATA_FILE || path.join(projectRoot, '.data', 'shipbrief.json'));
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || '';
const githubApiToken = process.env.GITHUB_API_TOKEN || '';
const maxWebhookBytes = 1_000_000;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function emptyStore() {
  return { repositories: [], drafts: [], runs: [], deliveries: [], updatedAt: null };
}

async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    return {
      repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw new Error(`Could not read ShipBrief data at ${dataFile}: ${error.message}`);
  }
}

let store = await loadStore();
let writeQueue = Promise.resolve();

function persistStore() {
  const tempFile = `${dataFile}.${process.pid}.tmp`;
  return mkdir(path.dirname(dataFile), { recursive: true })
    .then(() => writeFile(tempFile, JSON.stringify(store, null, 2), { mode: 0o600 }))
    .then(() => rename(tempFile, dataFile));
}

function updateStore(mutator) {
  const operation = writeQueue.then(async () => {
    const result = mutator(store);
    store.updatedAt = new Date().toISOString();
    await persistStore();
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = maxWebhookBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return { raw: Buffer.concat(chunks), value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function hasValidSignature(rawBody, header) {
  if (!webhookSecret || typeof header !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const supplied = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function shortText(value, limit = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function buildPushRecords(payload, deliveryId) {
  const repository = payload.repository;
  const repoName = shortText(repository?.full_name, 180);
  const repoUrl = safeHttpsUrl(repository?.html_url);
  const branch = shortText(String(payload.ref || '').replace(/^refs\/heads\//, ''), 140);
  const commits = Array.isArray(payload.commits) ? payload.commits.slice(-20) : [];
  const commitDetails = commits.map((commit) => {
    const sha = shortText(commit.id, 64);
    const message = shortText(commit.message, 500);
    const url = (repoUrl && sha ? `${repoUrl.replace(/\/$/, '')}/commit/${encodeURIComponent(sha)}` : null) || safeHttpsUrl(commit.url);
    return { sha, message, title: shortText(String(commit.message || '').split('\n')[0], 180), url };
  }).filter((commit) => commit.sha && commit.message);
  const compareUrl = safeHttpsUrl(payload.compare);
  const headSha = shortText(payload.after, 64) || commitDetails.at(-1)?.sha || '';
  const title = commitDetails.at(-1)?.title || `Changes to ${repoName} on ${branch || 'the pushed branch'}`;
  const summary = commitDetails.slice(-5).map((commit) => `• ${commit.title}`).join('\n');
  const evidenceUrl = compareUrl || commitDetails.at(-1)?.url || repoUrl;
  const text = [
    `A recent code update in ${repoName}.`,
    '',
    'What changed:',
    summary || title,
    '',
    evidenceUrl ? `Review the code: ${evidenceUrl}` : 'Review the pushed commits in GitHub.',
  ].join('\n');
  const now = new Date().toISOString();
  const id = `gh-${deliveryId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48)}`;
  const draft = {
    id, origin: 'github', channel: 'Product update', icon: '✦', title, text,
    status: 'Needs review', repo: repoName, commit: headSha.slice(0, 7), created: 'Just now',
    source: commitDetails.map((commit) => commit.title).join(' · ') || title,
    compareUrl, evidence: commitDetails.filter((commit) => commit.url), receivedAt: now,
  };
  const run = {
    id, title, repo: repoName, sha: headSha.slice(0, 7), when: 'Just now', state: 'Needs review',
    kind: 'GitHub push', icon: '⌘', receivedAt: now, compareUrl,
  };
  return { repoName, repoUrl, branch, headSha, draft, run };
}

async function findPullRequests(repoName, commits) {
  const [owner, repo] = repoName.split('/');
  if (!owner || !repo) return [];
  const shas = [...new Set(commits.slice(-3).map((commit) => commit.sha).filter(Boolean))];
  const requests = await Promise.all(shas.map(async (sha) => {
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10' };
    if (githubApiToken) headers.authorization = `Bearer ${githubApiToken}`;
    try {
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}/pulls`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return [];
      const pulls = await response.json();
      return Array.isArray(pulls) ? pulls.slice(0, 2).map((pull) => ({
        number: pull.number,
        title: shortText(pull.title, 180),
        url: safeHttpsUrl(pull.html_url),
        state: shortText(pull.state, 20),
      })).filter((pull) => pull.number && pull.title && pull.url) : [];
    } catch {
      return [];
    }
  }));
  const unique = new Map();
  requests.flat().forEach((pull) => unique.set(pull.number, pull));
  return [...unique.values()].slice(0, 5);
}

async function handleWebhook(req, res) {
  if (!webhookSecret) return sendJson(res, 503, { error: 'GitHub webhook signing secret is not configured.' });
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.status || 400, { error: error.message });
  }
  if (!hasValidSignature(body.raw, req.headers['x-hub-signature-256'])) {
    return sendJson(res, 401, { error: 'GitHub webhook signature is missing or invalid.' });
  }

  const deliveryId = shortText(req.headers['x-github-delivery'], 120);
  const eventName = shortText(req.headers['x-github-event'], 80);
  if (!deliveryId || !eventName) return sendJson(res, 400, { error: 'GitHub delivery and event headers are required.' });

  if (eventName !== 'push') {
    await updateStore((data) => {
      if (!data.deliveries.includes(deliveryId)) data.deliveries.push(deliveryId);
      data.deliveries = data.deliveries.slice(-5000);
    });
    return sendJson(res, 202, { accepted: true, ignored: true, reason: `The ${eventName} event is not handled yet.` });
  }

  const payload = body.value;
  if (!payload.repository?.full_name || !payload.ref || !Array.isArray(payload.commits)) {
    return sendJson(res, 400, { error: 'Push payload is missing repository, ref, or commits.' });
  }
  if (payload.deleted || payload.created === false && payload.before === '0000000000000000000000000000000000000000') {
    await updateStore((data) => {
      if (!data.deliveries.includes(deliveryId)) data.deliveries.push(deliveryId);
      data.deliveries = data.deliveries.slice(-5000);
    });
    return sendJson(res, 202, { accepted: true, ignored: true, reason: 'Branch deletion does not create a draft.' });
  }
  if (payload.commits.length === 0) {
    await updateStore((data) => {
      if (!data.deliveries.includes(deliveryId)) data.deliveries.push(deliveryId);
      data.deliveries = data.deliveries.slice(-5000);
    });
    return sendJson(res, 202, { accepted: true, ignored: true, reason: 'Push contains no commits.' });
  }

  await writeQueue;
  if (store.deliveries.includes(deliveryId)) return sendJson(res, 202, { accepted: true, duplicate: true, draftId: null });
  const record = buildPushRecords(payload, deliveryId);
  if (!record.repoName || !record.headSha) return sendJson(res, 400, { error: 'Push payload is missing a repository name or commit SHA.' });
  record.pullRequests = await findPullRequests(record.repoName, record.draft.evidence || []);
  record.draft.pullRequests = record.pullRequests;
  if (record.pullRequests.length) {
    const related = record.pullRequests.map((pull) => `Related pull request: ${pull.title} (#${pull.number}) ${pull.url}`).join('\n');
    record.draft.text += `\n\n${related}`;
    record.draft.source += ` · ${record.pullRequests.map((pull) => `#${pull.number} ${pull.title}`).join(' · ')}`;
  }

  const result = await updateStore((data) => {
    if (data.deliveries.includes(deliveryId)) return { duplicate: true };
    data.deliveries.push(deliveryId);
    data.deliveries = data.deliveries.slice(-5000);
    const existingRepo = data.repositories.find((repo) => repo.fullName === record.repoName);
    const repo = { fullName: record.repoName, branch: record.branch || 'unknown', htmlUrl: record.repoUrl, lastPushAt: record.draft.receivedAt };
    if (existingRepo) Object.assign(existingRepo, repo);
    else data.repositories.unshift(repo);
    data.drafts.unshift(record.draft);
    data.runs.unshift(record.run);
    data.drafts = data.drafts.slice(0, 500);
    data.runs = data.runs.slice(0, 500);
    return { duplicate: false, draftId: record.draft.id };
  }).catch((error) => {
    if (error.status) return { error: error.message, status: error.status };
    throw error;
  });

  if (result.error) return sendJson(res, result.status, { error: result.error });
  return sendJson(res, 202, { accepted: true, duplicate: result.duplicate, draftId: result.draftId || null });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    await writeQueue;
    return sendJson(res, 200, { ...store, deliveries: undefined, webhookConfigured: Boolean(webhookSecret) });
  }
  if (req.method === 'POST' && url.pathname === '/api/github/webhook') return handleWebhook(req, res);
  const draftMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)$/);
  if (req.method === 'PATCH' && draftMatch) {
    let parsed;
    try {
      parsed = (await readJson(req, 20_000)).value;
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
    const id = decodeURIComponent(draftMatch[1]);
    const result = await updateStore((data) => {
      const draft = data.drafts.find((item) => item.id === id && item.origin === 'github');
      if (!draft) return { status: 404, error: 'GitHub draft was not found.' };
      if (typeof parsed.text !== 'string' || !['Needs review', 'Approved'].includes(parsed.status)) {
        return { status: 400, error: 'A draft requires text and a valid review status.' };
      }
      draft.text = parsed.text.slice(0, 20_000);
      draft.status = parsed.status;
      draft.reviewedAt = parsed.status === 'Approved' ? new Date().toISOString() : null;
      const run = data.runs.find((item) => item.id === id);
      if (run) run.state = draft.status;
      return { status: 200, draft };
    });
    return sendJson(res, result.status, result.status === 200 ? { draft: result.draft } : { error: result.error });
  }
  return sendJson(res, 404, { error: 'API route not found.' });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Method not allowed');
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(publicRoot, relativePath);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error('Request failed:', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'ShipBrief could not complete the request.' });
    else res.end();
  }
});

server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
  console.log(`ShipBrief running at http://localhost:${process.env.PORT || 4173}`);
  console.log(`GitHub webhook intake: ${webhookSecret ? 'configured' : 'disabled (set GITHUB_WEBHOOK_SECRET)'}`);
});
