import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/run.js';
import { codePointLength } from '../src/notes.js';
import { API, REPO, baseEnv, commit, issueItem, link, milestone, parseOutputFile, pullItem, readText, sha, stubFetch, withTempDir } from './helpers.js';

const milestonesUrl = `${API}/repos/${REPO}/milestones?state=all&per_page=100`;
const issuesUrl = `${API}/repos/${REPO}/issues?milestone=7&state=closed&per_page=100`;
const issuesPage2 = `${API}/repositories/123/issues?milestone=7&state=closed&per_page=100&page=2`;

const milestoneRoutes = {
  [milestonesUrl]: { body: [milestone(6, 'v1.4.0', 'closed'), milestone(7, 'v1.5.0')] },
  [issuesUrl]: {
    body: [
      issueItem({ number: 11, title: 'ABC-11: feat(list): share wishlists', labels: ['feature'], mergedAt: '2026-10-02T09:00:00Z' }),
      issueItem({ number: 12, title: 'Bump okhttp', labels: ['dependencies'], mergedAt: '2026-10-02T10:00:00Z' }),
      issueItem({ number: 13, title: 'Abandoned attempt', labels: ['feature'], mergedAt: null }),
      issueItem({
        number: 14,
        title: '[ABC-14] fix: crash',
        labels: ['bug'],
        mergedAt: '2026-10-01T09:00:00Z',
        body: 'Root cause was a race.\n\n<!-- release-note -->\nFixed a crash when opening the app offline\n<!-- /release-note -->',
      }),
    ],
    headers: { link: link(issuesPage2, issuesPage2) },
  },
  [issuesPage2]: {
    body: [
      issueItem({ number: 15, title: 'Refactor build scripts', labels: ['internal'], mergedAt: '2026-10-03T09:00:00Z' }),
      issueItem({ number: 16, title: 'chore: tidy settings screen', mergedAt: '2026-10-04T09:00:00Z' }),
      issueItem({ number: 17, title: 'Bug report: something', isPull: false }),
    ],
  },
};

function env(dir, overrides = {}) {
  const outputFile = join(dir, 'output.txt');
  const summaryFile = join(dir, 'summary.md');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  return {
    ...baseEnv({ GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile, GITHUB_WORKSPACE: dir }),
    ...overrides,
  };
}

function quietLog() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

describe('run with a milestone', () => {
  it('builds notes, writes both Play layouts, the App Store file, outputs and summary', () =>
    withTempDir(async (dir) => {
      const { fetchImpl, calls } = stubFetch(milestoneRoutes);
      const { lines, log } = quietLog();
      const result = await run({
        env: env(dir, {
          INPUT_MILESTONE: 'v1.5.0',
          INPUT_SECTIONS: 'feature:✨ New,bug:🐛 Fixes,improvement:⚡ Improvements',
          INPUT_HEADER: 'v{version}',
          INPUT_VERSION: '1.5.0',
          INPUT_LOCALES: 'en-US, de-DE',
          'INPUT_PLAY-DIR': 'distribution/whatsnew',
          'INPUT_PLAY-GPP-DIR': 'app/src/main/play/release-notes',
          'INPUT_APPSTORE-FILE': 'fastlane/metadata/en-US/release_notes.txt',
        }),
        fetchImpl,
        log,
      });

      const expected = 'v1.5.0\n\n✨ New\n- Share wishlists\n\n🐛 Fixes\n- Fixed a crash when opening the app offline\n\nOther changes\n- Tidy settings screen';
      assert.equal(result.outputs['play-notes'], expected);
      assert.equal(result.outputs['appstore-notes'], expected);
      assert.deepEqual(calls.map((call) => call.url), [milestonesUrl, issuesUrl, issuesPage2]);

      assert.equal(readText(join(dir, 'distribution/whatsnew/whatsnew-en-US')), expected);
      assert.equal(readText(join(dir, 'distribution/whatsnew/whatsnew-de-DE')), expected);
      assert.deepEqual(readdirSync(join(dir, 'distribution/whatsnew')).sort(), ['whatsnew-de-DE', 'whatsnew-en-US']);
      assert.equal(readText(join(dir, 'app/src/main/play/release-notes/en-US/default.txt')), expected);
      assert.equal(readText(join(dir, 'app/src/main/play/release-notes/de-DE/default.txt')), expected);
      assert.equal(readText(join(dir, 'fastlane/metadata/en-US/release_notes.txt')), expected);
      assert.equal(result.files.length, 5);

      const outputs = parseOutputFile(readText(join(dir, 'output.txt')));
      assert.deepEqual(outputs, {
        'play-notes': expected,
        'appstore-notes': expected,
        markdown: result.outputs.markdown,
        'pr-count': '3',
        truncated: 'false',
      });
      assert.match(readText(join(dir, 'output.txt')), /^play-notes<<ghadelimiter_[0-9a-f-]{36}\n/);
      assert.match(outputs.markdown, /^## v1\.5\.0\n\n### ✨ New\n\n- Share wishlists \(\[#11\]\(https:\/\/github\.com\/octo-org\/mobile-app\/pull\/11\)\) by @dev-one/);

      const summary = readText(join(dir, 'summary.md'));
      assert.ok(summary.startsWith(outputs.markdown));
      assert.match(summary, /3 pull requests from milestone 'v1\.5\.0' \(#7\)/);
      assert.ok(lines.some((line) => /Skipped 1 closed pull requests/.test(line)));
      assert.ok(lines.some((line) => /Excluded 2 pull requests by label filters/.test(line)));
      assert.ok(!lines.some((line) => line.startsWith('::warning::')));
    }));

  it('fails when the milestone does not exist', () =>
    withTempDir(async (dir) => {
      const { fetchImpl } = stubFetch(milestoneRoutes);
      await assert.rejects(run({ env: env(dir, { INPUT_MILESTONE: 'v2.0.0' }), fetchImpl, log: () => {} }), /Milestone 'v2\.0\.0' not found/);
      assert.equal(readText(join(dir, 'output.txt')), '');
    }));

  it('fails before calling the API when no source is given', () =>
    withTempDir(async (dir) => {
      const { fetchImpl, calls } = stubFetch({});
      await assert.rejects(run({ env: env(dir), fetchImpl, log: () => {} }), /exactly one source/);
      await assert.rejects(run({ env: env(dir, { INPUT_MILESTONE: 'x', 'INPUT_FROM-TAG': 'v1' }), fetchImpl, log: () => {} }), /cannot be used together/);
      assert.equal(calls.length, 0);
    }));

  it('truncates Play notes to 500 code points and flags truncated', () =>
    withTempDir(async (dir) => {
      const many = Array.from({ length: 30 }, (_, index) =>
        issueItem({ number: 300 + index, title: `🚀 Feature ${index} brings a noticeably better experience`, labels: [index < 10 ? 'feature' : 'bug'], mergedAt: `2026-10-01T${String(index % 24).padStart(2, '0')}:00:00Z` }),
      );
      const { fetchImpl } = stubFetch({
        [milestonesUrl]: milestoneRoutes[milestonesUrl],
        [issuesUrl]: { body: many },
      });
      const { lines, log } = quietLog();
      const result = await run({
        env: env(dir, { INPUT_MILESTONE: '7', INPUT_SECTIONS: 'feature:✨ New,bug:🐛 Fixes', 'INPUT_PLAY-DIR': 'play' }),
        fetchImpl,
        log,
      });
      const play = readText(join(dir, 'play/whatsnew-en-US'));
      assert.ok(codePointLength(play) <= 500);
      assert.ok(play.endsWith('\n…and more'));
      assert.ok(play.includes('✨ New'));
      assert.equal(result.outputs.truncated, 'true');
      assert.equal(result.outputs['pr-count'], 30);
      assert.ok(!result.outputs['appstore-notes'].includes('…and more'));
      assert.ok(lines.some((line) => /^::warning::Google Play notes were shortened by \d+ items/.test(line)));
    }));
});

describe('run with a tag range', () => {
  it('collects pull requests between refs and tolerates zero results', () =>
    withTempDir(async (dir) => {
      const compare = `${API}/repos/${REPO}/compare/v1.4.0...${sha(999)}?per_page=100`;
      const { fetchImpl, calls } = stubFetch({
        [compare]: { body: { status: 'ahead', total_commits: 1, commits: [commit(sha(5))], files: [] } },
        [`${API}/repos/${REPO}/commits/${sha(5)}/pulls?per_page=100`]: { body: [] },
      });
      const { lines, log } = quietLog();
      const result = await run({
        env: env(dir, { 'INPUT_FROM-TAG': 'v1.4.0', INPUT_HEADER: 'Release {version}', INPUT_VERSION: '1.5.0', 'INPUT_PLAY-DIR': 'play', 'INPUT_APPSTORE-FILE': 'notes.txt' }),
        fetchImpl,
        log,
      });
      assert.equal(calls.length, 2);
      assert.equal(result.outputs['play-notes'], 'Release 1.5.0');
      assert.equal(result.outputs['pr-count'], 0);
      assert.equal(result.outputs.markdown, '## Release 1.5.0\n\n_No pull requests matched._');
      assert.ok(existsSync(join(dir, 'play/whatsnew-en-US')));
      assert.equal(readText(join(dir, 'notes.txt')), 'Release 1.5.0');
      assert.ok(lines.some((line) => line.startsWith('::warning::No pull requests matched')));
      const outputs = parseOutputFile(readText(join(dir, 'output.txt')));
      assert.equal(outputs['play-notes'], 'Release 1.5.0');
      assert.equal(outputs['pr-count'], '0');
    }));

  it('uses to-ref and the flat layout without sections', () =>
    withTempDir(async (dir) => {
      const compare = `${API}/repos/${REPO}/compare/v1.4.0...v1.5.0?per_page=100`;
      const { fetchImpl } = stubFetch({
        [compare]: { body: { status: 'ahead', total_commits: 2, commits: [commit(sha(1)), commit(sha(2))], files: [] } },
        [`${API}/repos/${REPO}/commits/${sha(1)}/pulls?per_page=100`]: {
          body: [pullItem({ number: 41, title: 'fix(cart): rounding', mergedAt: '2026-10-02T00:00:00Z', body: 'Release note: Prices now round correctly' })],
        },
        [`${API}/repos/${REPO}/commits/${sha(2)}/pulls?per_page=100`]: {
          body: [pullItem({ number: 40, title: 'MOB-40: Add Pay later', mergedAt: '2026-10-01T00:00:00Z' })],
        },
      });
      const result = await run({
        env: env(dir, { 'INPUT_FROM-TAG': 'v1.4.0', 'INPUT_TO-REF': 'v1.5.0', INPUT_HEADER: 'v{version}', INPUT_VERSION: '1.5.0' }),
        fetchImpl,
        log: () => {},
      });
      assert.equal(result.outputs['play-notes'], 'v1.5.0\n- Add Pay later\n- Prices now round correctly');
      assert.equal(result.files.length, 0);
    }));
});
