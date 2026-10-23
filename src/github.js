export class GitHubError extends Error {
  constructor(status, url, message) {
    super(`GitHub API ${status} for ${url}: ${message}`);
    this.status = status;
    this.url = url;
  }
}

export function nextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match && match[2].split(/\s+/).includes('next')) return match[1];
  }
  return null;
}

function encodeRef(ref) {
  return ref.split('/').map(encodeURIComponent).join('/');
}

export function createClient({ token, apiUrl, fetchImpl }) {
  const origin = new URL(apiUrl).origin;
  let calls = 0;

  async function request(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${apiUrl}${pathOrUrl}`;
    if (new URL(url).origin !== origin) {
      throw new Error(`Refusing to follow a link outside ${origin}: ${url}`);
    }
    calls += 1;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'store-release-notes-action',
      },
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const message = body && typeof body === 'object' && body.message ? body.message : String(text || response.statusText);
      throw new GitHubError(response.status, url, message);
    }
    return { body, next: nextLink(response.headers.get('link')) };
  }

  async function* paginate(path) {
    let url = path;
    while (url) {
      const { body, next } = await request(url);
      yield body;
      url = next;
    }
  }

  return {
    request,
    paginate,
    get calls() {
      return calls;
    },
  };
}

export function normalizePullRequest(item) {
  return {
    number: item.number,
    title: item.title ?? '',
    body: item.body ?? '',
    labels: (item.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)).filter(Boolean),
    url: item.html_url ?? '',
    author: item.user?.login ?? '',
    mergedAt: item.pull_request?.merged_at ?? item.merged_at ?? null,
  };
}

export async function resolveMilestone(client, repository, value) {
  const milestones = [];
  for await (const page of client.paginate(`/repos/${repository}/milestones?state=all&per_page=100`)) {
    milestones.push(...page);
  }
  const wanted = value.trim();
  const found =
    milestones.find((milestone) => milestone.title === wanted) ??
    milestones.find((milestone) => milestone.title.trim().toLowerCase() === wanted.toLowerCase()) ??
    (/^[0-9]+$/.test(wanted) ? milestones.find((milestone) => milestone.number === Number(wanted)) : undefined);
  if (!found) {
    const available = milestones.slice(0, 10).map((milestone) => `'${milestone.title}'`).join(', ');
    throw new Error(
      `Milestone '${wanted}' not found in ${repository}` + (available ? `; available: ${available}` : '; the repository has no milestones'),
    );
  }
  return { number: found.number, title: found.title, url: found.html_url ?? '' };
}

export async function listMilestonePullRequests(client, repository, milestoneNumber, maxPrs) {
  const prs = [];
  let skipped = 0;
  let capped = false;
  const path = `/repos/${repository}/issues?milestone=${milestoneNumber}&state=closed&per_page=100`;
  outer: for await (const page of client.paginate(path)) {
    for (const item of page) {
      if (!item.pull_request) continue;
      if (!item.pull_request.merged_at) {
        skipped += 1;
        continue;
      }
      if (prs.length >= maxPrs) {
        capped = true;
        break outer;
      }
      prs.push(normalizePullRequest(item));
    }
  }
  return { prs, skipped, capped };
}

export async function listPullRequestsBetween(client, repository, base, head, maxPrs) {
  const shas = [];
  for await (const page of client.paginate(`/repos/${repository}/compare/${encodeRef(base)}...${encodeRef(head)}?per_page=100`)) {
    for (const commit of page.commits ?? []) shas.push(commit.sha);
  }
  const prs = [];
  const seen = new Set();
  let skipped = 0;
  let capped = false;
  let inspected = 0;
  outer: for (const sha of shas) {
    const { body } = await client.request(`/repos/${repository}/commits/${sha}/pulls?per_page=100`);
    inspected += 1;
    for (const pr of body ?? []) {
      if (seen.has(pr.number)) continue;
      seen.add(pr.number);
      if (!pr.merged_at) {
        skipped += 1;
        continue;
      }
      if (prs.length >= maxPrs) {
        capped = true;
        break outer;
      }
      prs.push(normalizePullRequest(pr));
    }
    if (prs.length >= maxPrs && inspected < shas.length) {
      capped = true;
      break;
    }
  }
  return { prs, skipped, capped, commits: shas.length, inspected };
}
