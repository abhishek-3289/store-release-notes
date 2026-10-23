export const PLAY_LIMIT = 500;
export const APP_STORE_LIMIT = 4000;
export const MORE_LINE = '…and more';

export function codePointLength(text) {
  return [...text].length;
}

const BLOCK_PATTERN = /<!--\s*release-note\s*-->([\s\S]*?)<!--\s*\/release-note\s*-->/i;
const LINE_PATTERN = /^[ \t]*release note:[ \t]*(\S.*)$/im;
const TICKET_BRACKET = /^\s*\[[A-Z][A-Z0-9]+-[0-9]+\]\s*[:\-|]?\s*/;
const TICKET_PLAIN = /^\s*[A-Z][A-Z0-9]+-[0-9]+\s*[:\-|]\s*/;
const CONVENTIONAL = /^\s*(feat|feature|fix|bugfix|hotfix|chore|docs|style|refactor|perf|test|tests|build|ci|revert|improvement|deps)(\([^)]*\))?!?\s*:\s*/i;

function squash(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export function cleanTitle(text) {
  let current = text;
  for (;;) {
    const next = current.replace(TICKET_BRACKET, '').replace(TICKET_PLAIN, '').replace(CONVENTIONAL, '');
    if (next === current) break;
    current = next;
  }
  current = squash(current);
  return current.charAt(0).toUpperCase() + current.slice(1);
}

export function releaseNoteFromBody(body) {
  const normalized = (body ?? '').replace(/\r\n?/g, '\n');
  const block = normalized.match(BLOCK_PATTERN);
  if (block) {
    const text = squash(
      block[1]
        .split('\n')
        .map((line) => line.trim().replace(/^[-*•]\s+/, ''))
        .filter((line) => line.length > 0)
        .join(' '),
    );
    if (text) return text;
  }
  const line = normalized.match(LINE_PATTERN);
  if (line) {
    const text = squash(line[1]);
    if (text) return text;
  }
  return null;
}

export function lineText(pr, clean) {
  const raw = releaseNoteFromBody(pr.body) ?? pr.title;
  const text = clean ? cleanTitle(raw) : squash(raw);
  return text || squash(pr.title) || `#${pr.number}`;
}

export function filterPullRequests(prs, { includeLabels, excludeLabels }) {
  const kept = [];
  const excluded = [];
  for (const pr of prs) {
    const labels = pr.labels.map((label) => label.toLowerCase());
    const hasExcluded = labels.some((label) => excludeLabels.includes(label));
    const hasIncluded = includeLabels.length === 0 || labels.some((label) => includeLabels.includes(label));
    if (hasExcluded || !hasIncluded) {
      excluded.push(pr);
    } else {
      kept.push(pr);
    }
  }
  return { kept, excluded };
}

export function sortPullRequests(prs) {
  return [...prs].sort((a, b) => {
    const left = a.mergedAt ? Date.parse(a.mergedAt) : 0;
    const right = b.mergedAt ? Date.parse(b.mergedAt) : 0;
    return left - right || a.number - b.number;
  });
}

export function groupIntoSections(prs, { sections, otherSectionTitle, includeUnlabeled, cleanTitles }) {
  const groups = sections.map((section) => ({ title: section.title, items: [] }));
  const other = { title: sections.length > 0 ? otherSectionTitle : '', items: [] };
  let dropped = 0;
  for (const pr of prs) {
    const labels = pr.labels.map((label) => label.toLowerCase());
    const index = sections.findIndex((section) => section.labels.some((label) => labels.includes(label)));
    const item = { text: lineText(pr, cleanTitles), pr };
    if (index >= 0) {
      groups[index].items.push(item);
    } else if (includeUnlabeled) {
      other.items.push(item);
    } else {
      dropped += 1;
    }
  }
  groups.push(other);
  return { groups: groups.filter((group) => group.items.length > 0), dropped };
}

function hasHeadings(groups) {
  return groups.some((group) => group.title);
}

export function renderPlain(header, allGroups, truncated = false) {
  const groups = allGroups.filter((group) => group.items.length > 0);
  const blocks = groups.map((group) => [...(group.title ? [group.title] : []), ...group.items.map((item) => `- ${item.text}`)].join('\n'));
  let body = blocks.join(hasHeadings(groups) ? '\n\n' : '\n');
  if (truncated) body = body ? `${body}\n${MORE_LINE}` : MORE_LINE;
  if (!header) return body;
  if (!body) return header;
  return `${header}${hasHeadings(groups) ? '\n\n' : '\n'}${body}`;
}

export function fitToLimit(header, groups, limit) {
  const full = renderPlain(header, groups);
  if (codePointLength(full) <= limit) {
    return { text: full, truncated: false, droppedItems: 0 };
  }
  const working = groups.map((group) => ({ ...group, items: [...group.items] }));
  let droppedItems = 0;
  for (;;) {
    const last = working.findLast((group) => group.items.length > 0);
    if (!last) break;
    last.items.pop();
    droppedItems += 1;
    const text = renderPlain(header, working, true);
    if (codePointLength(text) <= limit) {
      return { text, truncated: true, droppedItems };
    }
  }
  throw new Error(`header is too long to fit the ${limit} character limit`);
}

export function renderMarkdown(header, groups) {
  const lines = [];
  if (header) lines.push(`## ${header}`, '');
  if (groups.length === 0) {
    lines.push('_No pull requests matched._');
    return lines.join('\n');
  }
  groups.forEach((group, index) => {
    if (group.title) lines.push(`### ${group.title}`, '');
    for (const { text, pr } of group.items) {
      const link = pr.url ? `[#${pr.number}](${pr.url})` : `#${pr.number}`;
      lines.push(`- ${text} (${link})${pr.author ? ` by @${pr.author}` : ''}`);
    }
    if (index < groups.length - 1) lines.push('');
  });
  return lines.join('\n');
}

export function buildNotes(prs, config) {
  const { kept, excluded } = filterPullRequests(prs, config);
  const { groups, dropped } = groupIntoSections(sortPullRequests(kept), config);
  const play = fitToLimit(config.header, groups, PLAY_LIMIT);
  const appStore = fitToLimit(config.header, groups, APP_STORE_LIMIT);
  return {
    groups,
    prCount: groups.reduce((total, group) => total + group.items.length, 0),
    excludedCount: excluded.length,
    unlabeledDropped: dropped,
    play,
    appStore,
    markdown: renderMarkdown(config.header, groups),
    truncated: play.truncated || appStore.truncated,
  };
}
