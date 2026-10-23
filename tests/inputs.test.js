import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InputError, getInput, parseInputs, parseList, parseSections } from '../src/inputs.js';
import { baseEnv, sha } from './helpers.js';

describe('parseInputs', () => {
  it('fails when neither milestone nor from-tag is given', () => {
    assert.throws(() => parseInputs(baseEnv()), (error) => error instanceof InputError && /exactly one source/.test(error.message));
  });

  it('fails when both milestone and from-tag are given', () => {
    assert.throws(
      () => parseInputs(baseEnv({ INPUT_MILESTONE: 'v1.5.0', 'INPUT_FROM-TAG': 'v1.4.0' })),
      /cannot be used together/,
    );
  });

  it('treats whitespace-only inputs as empty', () => {
    assert.throws(() => parseInputs(baseEnv({ INPUT_MILESTONE: '   ', 'INPUT_FROM-TAG': '' })), /exactly one source/);
  });

  it('reads the runner input names with dashes kept', () => {
    assert.equal(getInput({ 'INPUT_PLAY-DIR': ' fastlane/play ' }, 'play-dir'), 'fastlane/play');
  });

  it('uses defaults that match action.yml', () => {
    const config = parseInputs(baseEnv({ INPUT_MILESTONE: 'v1.5.0' }));
    assert.deepEqual(config.source, { type: 'milestone', milestone: 'v1.5.0' });
    assert.equal(config.maxPrs, 200);
    assert.deepEqual(config.excludeLabels, ['skip-release-notes', 'internal', 'dependencies']);
    assert.deepEqual(config.includeLabels, []);
    assert.deepEqual(config.sections, []);
    assert.equal(config.otherSectionTitle, 'Other changes');
    assert.equal(config.includeUnlabeled, true);
    assert.equal(config.cleanTitles, true);
    assert.deepEqual(config.locales, ['en-US']);
    assert.equal(config.repository, 'octo-org/mobile-app');
    assert.equal(config.apiUrl, 'https://api.github.com');
  });

  it('defaults to-ref to GITHUB_SHA and then HEAD', () => {
    assert.equal(parseInputs(baseEnv({ 'INPUT_FROM-TAG': 'v1.4.0' })).source.toRef, sha(999));
    assert.equal(parseInputs(baseEnv({ 'INPUT_FROM-TAG': 'v1.4.0', GITHUB_SHA: '' })).source.toRef, 'HEAD');
    assert.equal(parseInputs(baseEnv({ 'INPUT_FROM-TAG': 'v1.4.0', 'INPUT_TO-REF': 'v1.5.0' })).source.toRef, 'v1.5.0');
  });

  it('warns that to-ref is ignored for milestones', () => {
    const config = parseInputs(baseEnv({ INPUT_MILESTONE: '7', 'INPUT_TO-REF': 'main' }));
    assert.deepEqual(config.warnings, ['to-ref is ignored when milestone is used']);
  });

  it('replaces the {version} placeholder in the header', () => {
    const config = parseInputs(baseEnv({ INPUT_MILESTONE: 'v1.5.0', INPUT_HEADER: 'v{version} ({version})', INPUT_VERSION: '1.5.0' }));
    assert.equal(config.header, 'v1.5.0 (1.5.0)');
  });

  it('warns when the header uses {version} without a version', () => {
    const config = parseInputs(baseEnv({ INPUT_MILESTONE: 'v1.5.0', INPUT_HEADER: 'v{version}' }));
    assert.equal(config.header, 'v');
    assert.match(config.warnings[0], /version input is empty/);
  });

  it('validates max-prs, booleans, locales and repository', () => {
    const env = baseEnv({ INPUT_MILESTONE: 'v1.5.0' });
    assert.throws(() => parseInputs({ ...env, 'INPUT_MAX-PRS': '0' }), /max-prs/);
    assert.throws(() => parseInputs({ ...env, 'INPUT_MAX-PRS': 'ten' }), /max-prs/);
    assert.throws(() => parseInputs({ ...env, 'INPUT_CLEAN-TITLES': 'yes' }), /clean-titles/);
    assert.throws(() => parseInputs({ ...env, 'INPUT_INCLUDE-UNLABELED': 'nope' }), /include-unlabeled/);
    assert.throws(() => parseInputs({ ...env, INPUT_LOCALES: 'en-US,../../etc' }), /valid locale/);
    assert.throws(() => parseInputs({ ...env, INPUT_LOCALES: ' , ' }), /at least one locale/);
    assert.throws(() => parseInputs({ ...env, INPUT_REPOSITORY: 'not a repo' }), /owner\/name/);
    assert.throws(() => parseInputs({ ...env, 'INPUT_GITHUB-TOKEN': '' }), /github-token/);
    assert.equal(parseInputs({ ...env, 'INPUT_CLEAN-TITLES': 'FALSE' }).cleanTitles, false);
  });

  it('accepts an explicit repository and lowercases label filters', () => {
    const config = parseInputs(
      baseEnv({ INPUT_MILESTONE: '3', INPUT_REPOSITORY: 'someone/other-app', 'INPUT_INCLUDE-LABELS': 'Feature, BUG', 'INPUT_EXCLUDE-LABELS': '' }),
    );
    assert.equal(config.repository, 'someone/other-app');
    assert.deepEqual(config.includeLabels, ['feature', 'bug']);
    assert.deepEqual(config.excludeLabels, []);
  });
});

describe('parseSections', () => {
  it('keeps order, splits on the first colon and merges labels sharing a title', () => {
    assert.deepEqual(parseSections('feature:✨ New,bug:🐛 Fixes: crashes,hotfix:🐛 Fixes: crashes, improvement :⚡ Improvements'), [
      { title: '✨ New', labels: ['feature'] },
      { title: '🐛 Fixes: crashes', labels: ['bug', 'hotfix'] },
      { title: '⚡ Improvements', labels: ['improvement'] },
    ]);
  });

  it('rejects entries without a label or a title', () => {
    assert.throws(() => parseSections('feature'), /label:Title/);
    assert.throws(() => parseSections(':Title'), /label:Title/);
    assert.throws(() => parseSections('bug:'), /label:Title/);
  });

  it('returns an empty list for an empty value', () => {
    assert.deepEqual(parseSections(''), []);
    assert.deepEqual(parseList(' , ,'), []);
  });
});
