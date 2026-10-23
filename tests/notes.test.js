import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_STORE_LIMIT,
  MORE_LINE,
  PLAY_LIMIT,
  buildNotes,
  cleanTitle,
  codePointLength,
  filterPullRequests,
  fitToLimit,
  groupIntoSections,
  lineText,
  releaseNoteFromBody,
  renderMarkdown,
  renderPlain,
} from '../src/notes.js';

function pr(number, title, labels = [], extra = {}) {
  return {
    number,
    title,
    body: '',
    labels,
    url: `https://github.com/octo-org/mobile-app/pull/${number}`,
    author: 'dev-one',
    mergedAt: `2026-10-${String(number % 28 + 1).padStart(2, '0')}T10:00:00Z`,
    ...extra,
  };
}

const sections = [
  { title: '✨ New', labels: ['feature'] },
  { title: '🐛 Fixes', labels: ['bug'] },
  { title: '⚡ Improvements', labels: ['improvement'] },
];

function config(overrides = {}) {
  return {
    includeLabels: [],
    excludeLabels: ['skip-release-notes', 'internal', 'dependencies'],
    sections,
    otherSectionTitle: 'Other changes',
    includeUnlabeled: true,
    cleanTitles: true,
    header: '',
    ...overrides,
  };
}

describe('cleanTitle', () => {
  const cases = [
    ['ABC-123: Add wishlist sharing', 'Add wishlist sharing'],
    ['[ABC-123] Add wishlist sharing', 'Add wishlist sharing'],
    ['[ABC-123]: fix crash on login', 'Fix crash on login'],
    ['feat: add dark mode', 'Add dark mode'],
    ['fix(checkout): handle empty cart', 'Handle empty cart'],
    ['feat(ui)!: new home screen', 'New home screen'],
    ['ABC-12: feat(search): faster results', 'Faster results'],
    ['fix: [MOB-9] crash when offline', 'Crash when offline'],
    ['ABC-1 - Better onboarding', 'Better onboarding'],
    ['Improve   search\tspeed', 'Improve search speed'],
    ['Covid-19 banner', 'Covid-19 banner'],
    ['Fixes for Android 15', 'Fixes for Android 15'],
  ];
  for (const [input, expected] of cases) {
    it(`cleans '${input}'`, () => assert.equal(cleanTitle(input), expected));
  }
});

describe('releaseNoteFromBody', () => {
  it('extracts a release-note block and joins its lines', () => {
    const body = '## Summary\r\nInternal refactor.\r\n\r\n<!-- release-note -->\r\n- Checkout is faster\r\n  on slow networks\r\n<!-- /release-note -->\r\n';
    assert.equal(releaseNoteFromBody(body), 'Checkout is faster on slow networks');
  });

  it('accepts flexible spacing and case in the markers', () => {
    assert.equal(releaseNoteFromBody('<!--Release-Note-->Hello<!--  /release-note -->'), 'Hello');
  });

  it('falls back to a Release note: line', () => {
    assert.equal(releaseNoteFromBody('Details\n\nRelease note: You can now share lists\nMore text'), 'You can now share lists');
    assert.equal(releaseNoteFromBody('release NOTE:   Spaced out  '), 'Spaced out');
  });

  it('prefers the block over the line and ignores empty blocks', () => {
    assert.equal(releaseNoteFromBody('Release note: line\n<!-- release-note -->block<!-- /release-note -->'), 'block');
    assert.equal(releaseNoteFromBody('<!-- release-note -->\n\n<!-- /release-note -->\nRelease note: line'), 'line');
  });

  it('returns null without a note', () => {
    assert.equal(releaseNoteFromBody(null), null);
    assert.equal(releaseNoteFromBody('A release note is not needed'), null);
    assert.equal(releaseNoteFromBody('Release note:'), null);
  });
});

describe('lineText', () => {
  it('uses the body note over the title and cleans it', () => {
    assert.equal(lineText(pr(1, 'ABC-1: refactor cart', [], { body: 'Release note: feat: cart remembers items' }), true), 'Cart remembers items');
  });

  it('keeps prefixes when cleaning is disabled', () => {
    assert.equal(lineText(pr(1, 'ABC-1: refactor  cart'), false), 'ABC-1: refactor cart');
  });

  it('falls back to the raw title when cleaning leaves nothing', () => {
    assert.equal(lineText(pr(1, 'ABC-1:'), true), 'ABC-1:');
  });
});

describe('filterPullRequests', () => {
  const prs = [
    pr(1, 'A', ['feature']),
    pr(2, 'B', ['Dependencies']),
    pr(3, 'C', ['bug', 'internal']),
    pr(4, 'D', []),
    pr(5, 'E', ['bug']),
  ];

  it('drops excluded labels case-insensitively', () => {
    const { kept, excluded } = filterPullRequests(prs, config());
    assert.deepEqual(kept.map((item) => item.number), [1, 4, 5]);
    assert.deepEqual(excluded.map((item) => item.number), [2, 3]);
  });

  it('keeps only included labels when include-labels is set, exclusions still win', () => {
    const { kept } = filterPullRequests(prs, config({ includeLabels: ['bug', 'feature'] }));
    assert.deepEqual(kept.map((item) => item.number), [1, 5]);
  });
});

describe('groupIntoSections', () => {
  it('orders by section and puts the first matching section first', () => {
    const prs = [pr(1, 'Other thing'), pr(2, 'Fix', ['bug']), pr(3, 'New', ['Feature', 'bug']), pr(4, 'Faster', ['improvement'])];
    const { groups } = groupIntoSections(prs, config());
    assert.deepEqual(
      groups.map((group) => [group.title, group.items.map((item) => item.pr.number)]),
      [
        ['✨ New', [3]],
        ['🐛 Fixes', [2]],
        ['⚡ Improvements', [4]],
        ['Other changes', [1]],
      ],
    );
  });

  it('drops unmapped pull requests when include-unlabeled is false', () => {
    const { groups, dropped } = groupIntoSections([pr(1, 'Other'), pr(2, 'Fix', ['bug'])], config({ includeUnlabeled: false }));
    assert.deepEqual(groups.map((group) => group.title), ['🐛 Fixes']);
    assert.equal(dropped, 1);
  });

  it('uses one untitled group when no sections are configured', () => {
    const { groups } = groupIntoSections([pr(1, 'One', ['bug']), pr(2, 'Two')], config({ sections: [] }));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, '');
  });
});

describe('renderPlain', () => {
  it('renders sections separated by blank lines under the header', () => {
    const { groups } = groupIntoSections([pr(1, 'feat: share lists', ['feature']), pr(2, 'fix: login crash', ['bug']), pr(3, 'Polish')], config());
    assert.equal(renderPlain('v1.5.0', groups), 'v1.5.0\n\n✨ New\n- Share lists\n\n🐛 Fixes\n- Login crash\n\nOther changes\n- Polish');
  });

  it('renders a flat list right under the header like existing release notes', () => {
    const { groups } = groupIntoSections([pr(1, 'Initial release')], config({ sections: [] }));
    assert.equal(renderPlain('v1.0.0', groups), 'v1.0.0\n- Initial release');
    assert.equal(renderPlain('', groups), '- Initial release');
    assert.equal(renderPlain('v1.0.0', []), 'v1.0.0');
  });
});

describe('fitToLimit', () => {
  it('keeps everything when it fits', () => {
    const { groups } = groupIntoSections([pr(1, 'Small')], config());
    assert.deepEqual(fitToLimit('v1', groups, PLAY_LIMIT), { text: 'v1\n\nOther changes\n- Small', truncated: false, droppedItems: 0 });
  });

  it('drops lowest priority items from the end and appends the more line', () => {
    const prs = [
      ...Array.from({ length: 6 }, (_, index) => pr(10 + index, `Feature number ${index} ${'x'.repeat(40)}`, ['feature'])),
      ...Array.from({ length: 6 }, (_, index) => pr(20 + index, `Bug number ${index} ${'y'.repeat(40)}`, ['bug'])),
      ...Array.from({ length: 6 }, (_, index) => pr(30 + index, `Other number ${index} ${'z'.repeat(40)}`)),
    ];
    const { groups } = groupIntoSections(prs, config());
    const result = fitToLimit('v2.0.0', groups, PLAY_LIMIT);
    assert.equal(result.truncated, true);
    assert.ok(codePointLength(result.text) <= PLAY_LIMIT);
    assert.ok(result.text.endsWith(`\n${MORE_LINE}`));
    assert.ok(!result.text.includes('Other number'));
    assert.ok(!result.text.includes('Other changes'));
    assert.ok(result.text.includes('Feature number 5'));
    const lines = result.text.split('\n');
    for (const line of lines) {
      assert.ok(line === '' || line === 'v2.0.0' || line === MORE_LINE || line.startsWith('- ') || ['✨ New', '🐛 Fixes'].includes(line), `cut line: ${line}`);
    }
    const kept = lines.filter((line) => line.startsWith('- ')).length;
    assert.equal(kept, 18 - result.droppedItems);
    const oneMore = renderPlain('v2.0.0', groups.map((group) => ({ ...group })), true);
    assert.ok(codePointLength(oneMore) > PLAY_LIMIT);
  });

  it('removes the last kept item first inside a section', () => {
    const { groups } = groupIntoSections([pr(1, 'a'.repeat(30)), pr(2, 'b'.repeat(30)), pr(3, 'c'.repeat(30))], config({ sections: [], cleanTitles: false }));
    const result = fitToLimit('', groups, 70);
    assert.equal(result.text, `- ${'a'.repeat(30)}\n${MORE_LINE}`);
    assert.equal(result.droppedItems, 2);
  });

  it('counts emoji as code points, not UTF-16 units', () => {
    const emojiTitle = '🎉'.repeat(240);
    const { groups } = groupIntoSections([pr(1, emojiTitle)], config({ sections: [], cleanTitles: false }));
    const text = renderPlain('', groups);
    assert.equal(text.length, 482);
    assert.equal(codePointLength(text), 242);
    assert.equal(fitToLimit('', groups, PLAY_LIMIT).truncated, false);
    const { groups: bigger } = groupIntoSections([pr(1, '🎉'.repeat(498))], config({ sections: [], cleanTitles: false }));
    assert.equal(codePointLength(renderPlain('', bigger)), 500);
    assert.equal(fitToLimit('', bigger, PLAY_LIMIT).truncated, false);
    const { groups: over } = groupIntoSections([pr(1, '🎉'.repeat(499))], config({ sections: [], cleanTitles: false }));
    assert.deepEqual(fitToLimit('', over, PLAY_LIMIT), { text: MORE_LINE, truncated: true, droppedItems: 1 });
  });

  it('fails when the header alone does not fit', () => {
    assert.throws(() => fitToLimit('h'.repeat(501), [], PLAY_LIMIT), /header is too long/);
    const { groups } = groupIntoSections([pr(1, 'x')], config());
    assert.throws(() => fitToLimit('h'.repeat(495), groups, PLAY_LIMIT), /header is too long/);
  });

  it('applies the 4000 App Store limit independently of the 500 Play limit', () => {
    const prs = Array.from({ length: 60 }, (_, index) => pr(index + 1, `Change ${index} ${'w'.repeat(80)}`, ['feature']));
    const notes = buildNotes(prs, config({ header: 'v3.0.0' }));
    assert.equal(notes.play.truncated, true);
    assert.equal(notes.appStore.truncated, true);
    assert.ok(codePointLength(notes.play.text) <= PLAY_LIMIT);
    assert.ok(codePointLength(notes.appStore.text) <= APP_STORE_LIMIT);
    assert.ok(codePointLength(notes.appStore.text) > 3900);
    assert.ok(notes.appStore.droppedItems < notes.play.droppedItems);
    assert.equal(notes.prCount, 60);
    assert.ok(notes.markdown.includes('Change 59'));
  });
});

describe('renderMarkdown', () => {
  it('lists every item with links and authors', () => {
    const { groups } = groupIntoSections([pr(4, 'fix: crash', ['bug']), pr(5, 'Docs', [], { author: '' })], config());
    assert.equal(
      renderMarkdown('v1.5.0', groups),
      [
        '## v1.5.0',
        '',
        '### 🐛 Fixes',
        '',
        '- Crash ([#4](https://github.com/octo-org/mobile-app/pull/4)) by @dev-one',
        '',
        '### Other changes',
        '',
        '- Docs ([#5](https://github.com/octo-org/mobile-app/pull/5))',
      ].join('\n'),
    );
  });

  it('says when nothing matched', () => {
    assert.equal(renderMarkdown('', []), '_No pull requests matched._');
  });
});

describe('buildNotes', () => {
  it('sorts by merge time before grouping', () => {
    const prs = [
      pr(2, 'Second', [], { mergedAt: '2026-10-05T00:00:00Z' }),
      pr(1, 'First', [], { mergedAt: '2026-10-01T00:00:00Z' }),
      pr(3, 'Third', [], { mergedAt: '2026-10-09T00:00:00Z' }),
    ];
    const notes = buildNotes(prs, config({ sections: [] }));
    assert.equal(notes.play.text, '- First\n- Second\n- Third');
    assert.equal(notes.truncated, false);
  });
});
