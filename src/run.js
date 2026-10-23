import { parseInputs } from './inputs.js';
import { createClient, listMilestonePullRequests, listPullRequestsBetween, resolveMilestone } from './github.js';
import { buildNotes, codePointLength } from './notes.js';
import { writeAppStoreFile, writeGppFiles, writePlayFiles } from './files.js';
import { escapeAnnotation, writeOutputs, writeSummary } from './output.js';

export async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const config = parseInputs(env);
  const warn = (message) => log(`::warning::${escapeAnnotation(message)}`);
  config.warnings.forEach(warn);

  const client = createClient({ token: config.token, apiUrl: config.apiUrl, fetchImpl });
  let fetched;
  let sourceDescription;
  if (config.source.type === 'milestone') {
    const milestone = await resolveMilestone(client, config.repository, config.source.milestone);
    sourceDescription = `milestone '${milestone.title}' (#${milestone.number})`;
    fetched = await listMilestonePullRequests(client, config.repository, milestone.number, config.maxPrs);
  } else {
    const { fromTag, toRef } = config.source;
    sourceDescription = `${fromTag}...${toRef}`;
    fetched = await listPullRequestsBetween(client, config.repository, fromTag, toRef, config.maxPrs);
    log(`Inspected ${fetched.inspected} of ${fetched.commits} commits between ${sourceDescription}`);
  }
  log(`Found ${fetched.prs.length} merged pull requests in ${sourceDescription} using ${client.calls} API calls`);
  if (fetched.skipped > 0) log(`Skipped ${fetched.skipped} closed pull requests that were not merged`);
  if (fetched.capped) warn(`Stopped after max-prs (${config.maxPrs}) pull requests; later changes are not included`);

  const notes = buildNotes(fetched.prs, config);
  if (notes.excludedCount > 0) log(`Excluded ${notes.excludedCount} pull requests by label filters`);
  if (notes.unlabeledDropped > 0) log(`Dropped ${notes.unlabeledDropped} pull requests without a mapped section label`);
  if (notes.prCount === 0) warn(`No pull requests matched in ${sourceDescription}; notes contain only the header`);
  if (notes.play.truncated) {
    warn(`Google Play notes were shortened by ${notes.play.droppedItems} items to fit ${codePointLength(notes.play.text)}/500 characters`);
  }
  if (notes.appStore.truncated) {
    warn(`App Store notes were shortened by ${notes.appStore.droppedItems} items to fit ${codePointLength(notes.appStore.text)}/4000 characters`);
  }

  const files = [];
  if (config.playDir) files.push(...writePlayFiles(config.workspace, config.playDir, config.locales, notes.play.text));
  if (config.playGppDir) files.push(...writeGppFiles(config.workspace, config.playGppDir, config.locales, notes.play.text));
  if (config.appStoreFile) files.push(writeAppStoreFile(config.workspace, config.appStoreFile, notes.appStore.text));
  files.forEach((file) => log(`Wrote ${file}`));

  const outputs = {
    'play-notes': notes.play.text,
    'appstore-notes': notes.appStore.text,
    markdown: notes.markdown,
    'pr-count': notes.prCount,
    truncated: notes.truncated ? 'true' : 'false',
  };
  writeOutputs(env, outputs);
  writeSummary(
    env,
    `${notes.markdown}\n\n_${notes.prCount} pull requests from ${sourceDescription}; ` +
      `Google Play ${codePointLength(notes.play.text)}/500, App Store ${codePointLength(notes.appStore.text)}/4000 characters` +
      `${notes.truncated ? ', truncated' : ''}._`,
  );
  return { outputs, files, notes };
}
