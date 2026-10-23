import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const API = 'https://api.github.com';
export const REPO = 'octo-org/mobile-app';

export function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    const { status = 200, body, headers = {} } = route;
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    });
  };
  return { fetchImpl, calls };
}

export function link(next, last) {
  const parts = [];
  if (next) parts.push(`<${next}>; rel="next"`);
  if (last) parts.push(`<${last}>; rel="last"`);
  return parts.join(', ');
}

export function label(name, color = 'ededed') {
  return { id: name.length * 1000 + 7, node_id: `LA_${name}`, url: `${API}/repos/${REPO}/labels/${encodeURIComponent(name)}`, name, color, default: false, description: null };
}

const milestoneRef = {
  url: `${API}/repos/${REPO}/milestones/7`,
  html_url: `https://github.com/${REPO}/milestone/7`,
  id: 9001007,
  number: 7,
  title: 'v1.5.0',
  state: 'open',
};

export function issueItem({ number, title, labels = [], mergedAt = '2026-10-01T10:00:00Z', isPull = true, body = null, login = 'dev-one' }) {
  const item = {
    url: `${API}/repos/${REPO}/issues/${number}`,
    repository_url: `${API}/repos/${REPO}`,
    html_url: `https://github.com/${REPO}/${isPull ? 'pull' : 'issues'}/${number}`,
    id: 2000000000 + number,
    node_id: `PR_kwDO${number}`,
    number,
    title,
    user: { login, id: 4242, type: 'User' },
    labels: labels.map((name) => label(name)),
    state: 'closed',
    locked: false,
    milestone: milestoneRef,
    comments: 0,
    created_at: '2026-09-20T08:00:00Z',
    updated_at: '2026-10-02T08:00:00Z',
    closed_at: mergedAt ?? '2026-10-02T08:00:00Z',
    author_association: 'MEMBER',
    body,
  };
  if (isPull) {
    item.draft = false;
    item.pull_request = {
      url: `${API}/repos/${REPO}/pulls/${number}`,
      html_url: `https://github.com/${REPO}/pull/${number}`,
      diff_url: `https://github.com/${REPO}/pull/${number}.diff`,
      patch_url: `https://github.com/${REPO}/pull/${number}.patch`,
      merged_at: mergedAt,
    };
  }
  return item;
}

export function pullItem({ number, title, labels = [], mergedAt = '2026-10-01T10:00:00Z', body = null, state = 'closed', login = 'dev-two' }) {
  return {
    url: `${API}/repos/${REPO}/pulls/${number}`,
    id: 3000000000 + number,
    node_id: `PR_kwDO${number}`,
    html_url: `https://github.com/${REPO}/pull/${number}`,
    number,
    state,
    locked: false,
    title,
    user: { login, id: 4343, type: 'User' },
    body,
    labels: labels.map((name) => label(name)),
    created_at: '2026-09-20T08:00:00Z',
    updated_at: '2026-10-02T08:00:00Z',
    closed_at: mergedAt,
    merged_at: mergedAt,
    merge_commit_sha: `m${String(number).padStart(39, '0')}`,
    draft: false,
    base: { ref: 'main', repo: { full_name: REPO } },
    head: { ref: `feature/${number}`, repo: { full_name: REPO } },
  };
}

export function milestone(number, title, state = 'open') {
  return {
    url: `${API}/repos/${REPO}/milestones/${number}`,
    html_url: `https://github.com/${REPO}/milestone/${number}`,
    labels_url: `${API}/repos/${REPO}/milestones/${number}/labels`,
    id: 9001000 + number,
    node_id: `MI_${number}`,
    number,
    title,
    description: '',
    creator: { login: 'release-bot', id: 1, type: 'Bot' },
    open_issues: 0,
    closed_issues: 3,
    state,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    due_on: null,
    closed_at: null,
  };
}

export function commit(sha, message = 'Merge pull request') {
  return {
    sha,
    node_id: `C_${sha}`,
    commit: { message, author: { name: 'Dev', email: 'dev@example.com', date: '2026-10-01T00:00:00Z' } },
    url: `${API}/repos/${REPO}/commits/${sha}`,
    html_url: `https://github.com/${REPO}/commit/${sha}`,
    parents: [],
  };
}

export function sha(n) {
  return String(n).padStart(40, 'a');
}

export function baseEnv(overrides = {}) {
  return {
    'INPUT_GITHUB-TOKEN': 'test-token',
    GITHUB_REPOSITORY: REPO,
    GITHUB_API_URL: API,
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_SHA: sha(999),
    ...overrides,
  };
}

export function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'store-release-notes-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }));
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function parseOutputFile(content) {
  const outputs = {};
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const heredoc = line.match(/^([^=<]+)<<(.+)$/);
    if (heredoc) {
      const value = [];
      index += 1;
      while (lines[index] !== heredoc[2]) {
        value.push(lines[index]);
        index += 1;
      }
      outputs[heredoc[1]] = value.join('\n');
    } else {
      const separator = line.indexOf('=');
      outputs[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return outputs;
}
