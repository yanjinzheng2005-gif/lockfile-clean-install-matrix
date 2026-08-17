import { readdir, readFile } from 'node:fs/promises';

const files = (await readdir('tests')).filter((file) => file.endsWith('.test.js')).sort();
let declarations = 0;
for (const file of files) declarations += ((await readFile(`tests/${file}`, 'utf8')).match(/\btest\s*\(/g) ?? []).length;
if (files.length < 4 || declarations < 15) {
  throw new Error(`Expected at least 4 test files and 15 declared tests; found ${files.length} files and ${declarations} declarations.`);
}
console.log(`Test presence check: PASS (${files.length} files, ${declarations} declarations)`);
