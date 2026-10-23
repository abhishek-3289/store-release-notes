import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { escapeAnnotation, formatOutput, writeOutputs, writeSummary } from '../src/output.js';
import { readText, withTempDir } from './helpers.js';

describe('formatOutput', () => {
  it('writes single-line values as name=value', () => {
    assert.equal(formatOutput('pr-count', 3), 'pr-count=3\n');
    assert.equal(formatOutput('play-notes', ''), 'play-notes=\n');
  });

  it('writes multi-line values with a heredoc delimiter', () => {
    assert.equal(formatOutput('play-notes', 'v1\n- a', () => 'EOF_1'), 'play-notes<<EOF_1\nv1\n- a\nEOF_1\n');
  });

  it('refuses a value that contains its delimiter', () => {
    assert.throws(() => formatOutput('x', 'a\nEOF_1', () => 'EOF_1'), /delimiter/);
  });
});

describe('writeOutputs and writeSummary', () => {
  it('appends to GITHUB_OUTPUT and GITHUB_STEP_SUMMARY', () =>
    withTempDir(async (dir) => {
      const env = { GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'summary') };
      writeOutputs(env, { truncated: 'false' });
      writeOutputs(env, { 'pr-count': 2 });
      writeSummary(env, '## Notes');
      assert.equal(readText(env.GITHUB_OUTPUT), 'truncated=false\npr-count=2\n');
      assert.equal(readText(env.GITHUB_STEP_SUMMARY), '## Notes\n');
    }));

  it('falls back to stdout without GITHUB_OUTPUT and skips the summary', () => {
    const written = [];
    writeOutputs({}, { truncated: 'true' }, (text) => written.push(text));
    writeSummary({}, 'ignored');
    assert.deepEqual(written, ['truncated=true\n']);
  });
});

describe('escapeAnnotation', () => {
  it('escapes characters that break workflow commands', () => {
    assert.equal(escapeAnnotation('50% done\r\nnext'), '50%25 done%0D%0Anext');
  });
});
