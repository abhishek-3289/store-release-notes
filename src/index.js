import { run } from './run.js';
import { escapeAnnotation } from './output.js';

try {
  await run();
} catch (error) {
  console.log(`::error::${escapeAnnotation(error.message)}`);
  process.exitCode = 1;
}
