import { readFile } from 'node:fs/promises';

const [file, expectedVerdict, expectedBaseline, expectedCandidate] = process.argv.slice(2);
if (!file || !expectedVerdict || !expectedBaseline || !expectedCandidate) {
  throw new Error('Usage: node scripts/assert-receipt.mjs <json> <verdict> <baseline-status> <candidate-status>');
}
const receipt = JSON.parse(await readFile(file, 'utf8'));
if (receipt.comparison?.verdict !== expectedVerdict) throw new Error(`Expected verdict ${expectedVerdict}, got ${receipt.comparison?.verdict}`);
if (receipt.baseline?.status !== expectedBaseline) throw new Error(`Expected baseline ${expectedBaseline}, got ${receipt.baseline?.status}`);
if (receipt.candidate?.status !== expectedCandidate) throw new Error(`Expected candidate ${expectedCandidate}, got ${receipt.candidate?.status}`);
const text = JSON.stringify(receipt);
for (const forbidden of ['LIFECYCLE_SCRIPT_EXECUTED', 'GITHUB_TOKEN=', 'github_pat_', '/home/runner/', '/Users/']) {
  if (text.includes(forbidden)) throw new Error(`Receipt leaked or executed forbidden material: ${forbidden}`);
}
console.log(`Receipt assertion: PASS (${expectedVerdict}, ${expectedBaseline}/${expectedCandidate})`);
