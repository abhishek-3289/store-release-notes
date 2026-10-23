import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

export function writePlayFiles(workspace, dir, locales, text) {
  return locales.map((locale) => writeText(resolve(workspace, dir, `whatsnew-${locale}`), text));
}

export function writeGppFiles(workspace, dir, locales, text) {
  return locales.map((locale) => writeText(resolve(workspace, dir, locale, 'default.txt'), text));
}

export function writeAppStoreFile(workspace, file, text) {
  return writeText(resolve(workspace, file), text);
}
