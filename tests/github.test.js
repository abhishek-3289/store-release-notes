import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubError,
  createClient,
  listMilestonePullRequests,
  listPullRequestsBetween,
  nextLink,
  resolveMilestone,
} from '../src/github.js';
import { API, REPO, commit, issueItem, link, milestone, pullItem, sha, stubFetch } from './helpers.js';

function client(routes) {
  const stub = stubFetch(routes);
  return { stub, client: createClient({ token: 'test-token', apiUrl: API, fetchImpl: stub.fetchImpl }) };
}

const milestonesUrl = `${API}/repos/${REPO}/milestones?state=all&per_page=100`;

describe('nextLink', () => {
  it('finds the next page in a GitHub Link header', () => {
    const header = `<${API}/repositories/1/issues?page=2>; rel="next", <${API}/repositories/1/issues?page=5>; rel="last"`;
    assert.equal(nextLink(header), `${API}/repositories/1/issues?page=2`);
    assert.equal(nextLink(`<${API}/x?page=1>; rel="prev", <${API}/x?page=1>; rel="first"`), null);
    assert.equal(nextLink(null), null);
  });
});

describe('createClient', () => {
  it('sends the GitHub REST headers with the token', async () => {
    const { stub, client: github } = client({ [milestonesUrl]: { body: [] } });
    await github.request(`/repos/${REPO}/milestones?state=all&per_page=100`);
    const { init } = stub.calls[0];
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    assert.equal(init.headers.Accept, 'application/vnd.github+json');
    assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.ok(init.headers['User-Agent']);
  });

  it('turns API errors into GitHubError with the message', async () => {
    const url = `${API}/repos/${REPO}/compare/v0.0.1...main?per_page=100`;
    const { client: github } = client({ [url]: { status: 404, body: { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' } } });
    await assert.rejects(github.request(url), (error) => error instanceof GitHubError && error.status === 404 && /Not Found/.test(error.message));
  });

  it('refuses to follow pagination links to another host', async () => {
    const { client: github } = client({ [milestonesUrl]: { body: [], headers: { link: link('https://evil.example.com/steal?page=2') } } });
    await assert.rejects(async () => {
      for await (const page of github.paginate(milestonesUrl)) assert.ok(page);
    }, /Refusing to follow/);
  });
});

describe('resolveMilestone', () => {
  const page2 = `${API}/repositories/123/milestones?state=all&per_page=100&page=2`;
  const routes = {
    [milestonesUrl]: { body: [milestone(3, 'v1.3.0', 'closed'), milestone(4, 'v1.4.0', 'closed')], headers: { link: link(page2, page2) } },
    [page2]: { body: [milestone(7, 'v1.5.0'), milestone(8, '42')] },
  };

  it('resolves a title across pages, including closed milestones', async () => {
    const { stub, client: github } = client(routes);
    assert.deepEqual(await resolveMilestone(github, REPO, 'v1.5.0'), { number: 7, title: 'v1.5.0', url: `https://github.com/${REPO}/milestone/7` });
    assert.deepEqual(stub.calls.map((call) => call.url), [milestonesUrl, page2]);
  });

  it('matches titles case-insensitively and numbers as a fallback', async () => {
    assert.equal((await resolveMilestone(client(routes).client, REPO, 'V1.4.0')).number, 4);
    assert.equal((await resolveMilestone(client(routes).client, REPO, '3')).number, 3);
    assert.equal((await resolveMilestone(client(routes).client, REPO, '42')).number, 8);
  });

  it('reports a missing milestone with the available titles', async () => {
    await assert.rejects(resolveMilestone(client(routes).client, REPO, 'v9.9.9'), /Milestone 'v9\.9\.9' not found in octo-org\/mobile-app; available: 'v1\.3\.0', 'v1\.4\.0', 'v1\.5\.0', '42'/);
    await assert.rejects(resolveMilestone(client({ [milestonesUrl]: { body: [] } }).client, REPO, 'v1'), /has no milestones/);
  });
});

describe('listMilestonePullRequests', () => {
  const first = `${API}/repos/${REPO}/issues?milestone=7&state=closed&per_page=100`;
  const second = `${API}/repositories/123/issues?milestone=7&state=closed&per_page=100&page=2`;
  const routes = {
    [first]: {
      body: [
        issueItem({ number: 101, title: 'Merged one', labels: ['feature'] }),
        issueItem({ number: 102, title: 'Closed without merge', mergedAt: null }),
        issueItem({ number: 103, title: 'A plain issue', isPull: false }),
      ],
      headers: { link: link(second, second) },
    },
    [second]: { body: [issueItem({ number: 104, title: 'Merged two', labels: ['bug'], body: 'Release note: Fixed it' })] },
  };

  it('pages through closed issues and keeps only merged pull requests', async () => {
    const { stub, client: github } = client(routes);
    const result = await listMilestonePullRequests(github, REPO, 7, 200);
    assert.deepEqual(result.prs.map((pr) => pr.number), [101, 104]);
    assert.equal(result.skipped, 1);
    assert.equal(result.capped, false);
    assert.deepEqual(stub.calls.map((call) => call.url), [first, second]);
    assert.deepEqual(result.prs[1], {
      number: 104,
      title: 'Merged two',
      body: 'Release note: Fixed it',
      labels: ['bug'],
      url: `https://github.com/${REPO}/pull/104`,
      author: 'dev-one',
      mergedAt: '2026-10-01T10:00:00Z',
    });
  });

  it('stops at max-prs without fetching more pages', async () => {
    const { stub, client: github } = client(routes);
    const result = await listMilestonePullRequests(github, REPO, 7, 1);
    assert.deepEqual(result.prs.map((pr) => pr.number), [101]);
    assert.equal(result.capped, true);
    assert.equal(stub.calls.length, 2);
  });
});

describe('listPullRequestsBetween', () => {
  const compare = `${API}/repos/${REPO}/compare/v1.4.0...release/1.5?per_page=100`;
  const compare2 = `${API}/repos/${REPO}/compare/v1.4.0...release/1.5?per_page=100&page=2`;
  const pulls = (n) => `${API}/repos/${REPO}/commits/${sha(n)}/pulls?per_page=100`;
  const routes = {
    [compare]: {
      body: { status: 'ahead', ahead_by: 4, behind_by: 0, total_commits: 4, commits: [commit(sha(1)), commit(sha(2))], files: [] },
      headers: { link: link(compare2, compare2) },
    },
    [compare2]: { body: { status: 'ahead', ahead_by: 4, behind_by: 0, total_commits: 4, commits: [commit(sha(3)), commit(sha(4))], files: [] } },
    [pulls(1)]: { body: [pullItem({ number: 201, title: 'feat: share' })] },
    [pulls(2)]: { body: [pullItem({ number: 201, title: 'feat: share' }), pullItem({ number: 300, title: 'Still open', state: 'open', mergedAt: null })] },
    [pulls(3)]: { body: [] },
    [pulls(4)]: { body: [pullItem({ number: 202, title: 'fix: crash', labels: ['bug'] })] },
  };

  it('lists commits across compare pages and de-duplicates merged pull requests', async () => {
    const { stub, client: github } = client(routes);
    const result = await listPullRequestsBetween(github, REPO, 'v1.4.0', 'release/1.5', 200);
    assert.deepEqual(result.prs.map((pr) => pr.number), [201, 202]);
    assert.equal(result.skipped, 1);
    assert.equal(result.commits, 4);
    assert.equal(result.inspected, 4);
    assert.equal(result.capped, false);
    assert.deepEqual(stub.calls.map((call) => call.url), [compare, compare2, pulls(1), pulls(2), pulls(3), pulls(4)]);
    assert.equal(github.calls, 6);
    assert.equal(result.prs[0].mergedAt, '2026-10-01T10:00:00Z');
  });

  it('stops calling the API once max-prs is reached', async () => {
    const { stub, client: github } = client(routes);
    const result = await listPullRequestsBetween(github, REPO, 'v1.4.0', 'release/1.5', 1);
    assert.deepEqual(result.prs.map((pr) => pr.number), [201]);
    assert.equal(result.capped, true);
    assert.equal(result.inspected, 1);
    assert.equal(stub.calls.length, 3);
  });

  it('surfaces an unknown ref as an API error', async () => {
    const url = `${API}/repos/${REPO}/compare/v0.0.0...${sha(9)}?per_page=100`;
    const { client: github } = client({ [url]: { status: 404, body: { message: 'Not Found' } } });
    await assert.rejects(listPullRequestsBetween(github, REPO, 'v0.0.0', sha(9), 200), /GitHub API 404/);
  });
});
