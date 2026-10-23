export const DEFAULTS = Object.freeze({
  'to-ref': '',
  'max-prs': '200',
  'include-labels': '',
  'exclude-labels': 'skip-release-notes,internal,dependencies',
  sections: '',
  'other-section-title': 'Other changes',
  'include-unlabeled': 'true',
  'clean-titles': 'true',
  header: '',
  version: '',
  locales: 'en-US',
  'play-dir': '',
  'play-gpp-dir': '',
  'appstore-file': '',
  milestone: '',
  'from-tag': '',
  'github-token': '',
  repository: '',
});

export class InputError extends Error {}

export function getInput(env, name) {
  const raw = env[`INPUT_${name.toUpperCase()}`];
  const value = raw === undefined ? DEFAULTS[name] ?? '' : raw;
  return value.trim();
}

export function parseList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseBoolean(name, value) {
  const normalized = value.toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new InputError(`${name} must be 'true' or 'false', got '${value}'`);
}

export function parseSections(value) {
  const sections = [];
  for (const entry of parseList(value)) {
    const separator = entry.indexOf(':');
    const label = separator === -1 ? '' : entry.slice(0, separator).trim();
    const title = separator === -1 ? '' : entry.slice(separator + 1).trim();
    if (!label || !title) {
      throw new InputError(`sections entries must look like 'label:Title', got '${entry}'`);
    }
    const existing = sections.find((section) => section.title === title);
    if (existing) {
      existing.labels.push(label.toLowerCase());
    } else {
      sections.push({ title, labels: [label.toLowerCase()] });
    }
  }
  return sections;
}

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseInputs(env) {
  const warnings = [];
  const milestone = getInput(env, 'milestone');
  const fromTag = getInput(env, 'from-tag');
  let toRef = getInput(env, 'to-ref');

  if (!milestone && !fromTag) {
    throw new InputError('Provide exactly one source: either milestone or from-tag');
  }
  if (milestone && fromTag) {
    throw new InputError('milestone and from-tag cannot be used together; provide exactly one source');
  }
  if (milestone && toRef) {
    warnings.push('to-ref is ignored when milestone is used');
  }
  if (fromTag && !toRef) {
    toRef = (env.GITHUB_SHA ?? '').trim() || 'HEAD';
  }

  const maxPrsRaw = getInput(env, 'max-prs');
  if (!/^[1-9][0-9]*$/.test(maxPrsRaw)) {
    throw new InputError(`max-prs must be a positive integer, got '${maxPrsRaw}'`);
  }

  const repository = getInput(env, 'repository') || (env.GITHUB_REPOSITORY ?? '').trim();
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new InputError(`repository must look like 'owner/name', got '${repository}'`);
  }

  const token = getInput(env, 'github-token');
  if (!token) {
    throw new InputError('github-token is required');
  }

  const locales = parseList(getInput(env, 'locales'));
  if (locales.length === 0) {
    throw new InputError('locales must contain at least one locale');
  }
  for (const locale of locales) {
    if (!LOCALE_PATTERN.test(locale)) {
      throw new InputError(`'${locale}' is not a valid locale code such as en-US`);
    }
  }

  const version = getInput(env, 'version');
  const headerTemplate = getInput(env, 'header');
  if (headerTemplate.includes('{version}') && !version) {
    warnings.push('header contains {version} but the version input is empty');
  }
  const header = headerTemplate.replaceAll('{version}', version);
  if (header.includes('\n')) {
    throw new InputError('header must be a single line');
  }

  return {
    source: milestone ? { type: 'milestone', milestone } : { type: 'range', fromTag, toRef },
    maxPrs: Number(maxPrsRaw),
    includeLabels: parseList(getInput(env, 'include-labels')).map((label) => label.toLowerCase()),
    excludeLabels: parseList(getInput(env, 'exclude-labels')).map((label) => label.toLowerCase()),
    sections: parseSections(getInput(env, 'sections')),
    otherSectionTitle: getInput(env, 'other-section-title'),
    includeUnlabeled: parseBoolean('include-unlabeled', getInput(env, 'include-unlabeled')),
    cleanTitles: parseBoolean('clean-titles', getInput(env, 'clean-titles')),
    header,
    version,
    locales,
    playDir: getInput(env, 'play-dir'),
    playGppDir: getInput(env, 'play-gpp-dir'),
    appStoreFile: getInput(env, 'appstore-file'),
    token,
    repository,
    apiUrl: ((env.GITHUB_API_URL ?? '').trim() || 'https://api.github.com').replace(/\/+$/, ''),
    serverUrl: ((env.GITHUB_SERVER_URL ?? '').trim() || 'https://github.com').replace(/\/+$/, ''),
    workspace: (env.GITHUB_WORKSPACE ?? '').trim() || process.cwd(),
    warnings,
  };
}
