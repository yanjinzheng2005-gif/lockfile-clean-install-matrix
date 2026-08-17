export const SENSITIVE_DIRECTORY_NAMES = new Set(['.ssh', '.aws', '.docker', '.gnupg']);
export const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  '.pnpm-store',
  '.yarn',
  'lockfile-matrix-results',
  ...SENSITIVE_DIRECTORY_NAMES,
]);
export const SENSITIVE_FILE_NAMES = new Set([
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.netrc',
  '.git-credentials',
  '.gitconfig',
]);

/** @param {string} name */
export function isSensitiveFileName(name) {
  return name === '.env' || name.startsWith('.env.') || SENSITIVE_FILE_NAMES.has(name) || /\.(?:key|pem|p12|pfx)$/i.test(name);
}

/** @param {string} name */
export function isCopyOmittedFileName(name) {
  return name === '.DS_Store' || isSensitiveFileName(name);
}
