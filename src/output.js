import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

export function formatOutput(name, value, makeDelimiter = () => `ghadelimiter_${randomUUID()}`) {
  const text = String(value);
  if (!/[\r\n]/.test(text)) return `${name}=${text}\n`;
  const delimiter = makeDelimiter();
  if (text.includes(delimiter)) {
    throw new Error(`Output ${name} contains its heredoc delimiter`);
  }
  return `${name}<<${delimiter}\n${text}\n${delimiter}\n`;
}

export function writeOutputs(env, outputs, write = process.stdout.write.bind(process.stdout)) {
  const content = Object.entries(outputs)
    .map(([name, value]) => formatOutput(name, value))
    .join('');
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, content, 'utf8');
  } else {
    write(content);
  }
}

export function writeSummary(env, markdown) {
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8');
  }
}

export function escapeAnnotation(message) {
  return String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
