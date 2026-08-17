import { stableJson } from './util.js';

/**
 * @param {import('./core.js').LegReceipt} baseline
 * @param {import('./core.js').LegReceipt} candidate
 */
export function compareLegs(baseline, candidate) {
  let verdict = 'INCONCLUSIVE';
  /** @type {string[]} */
  const reasons = [];

  if (baseline.status === 'PASS' && candidate.status === 'PASS') {
    const treeChanged = baseline.inventory?.digest !== candidate.inventory?.digest;
    const binsChanged = stableJson(baseline.binShims) !== stableJson(candidate.binShims);
    if (treeChanged || binsChanged) {
      verdict = 'REVIEW';
      if (treeChanged) reasons.push('The normalized logical dependency inventory changed.');
      if (binsChanged) reasons.push('The installed bin shim set changed.');
    } else {
      verdict = 'NO_REGRESSION';
      reasons.push('Both cold installs passed with the same normalized dependency inventory and bin shim set.');
    }
  } else if (baseline.status === 'PASS' && ['INSTALL_FAILED', 'HANG', 'MUTATED'].includes(candidate.status)) {
    verdict = 'REGRESSION';
    reasons.push(`The baseline passed but the candidate ended as ${candidate.status}.`);
  } else if (candidate.status === 'PASS' && ['INSTALL_FAILED', 'HANG', 'MUTATED'].includes(baseline.status)) {
    verdict = 'IMPROVEMENT';
    reasons.push(`The candidate passed while the baseline ended as ${baseline.status}.`);
  } else {
    reasons.push(`A deterministic comparison is unavailable: baseline=${baseline.status}, candidate=${candidate.status}.`);
  }

  return {
    verdict,
    reasons,
    dependencyDiff: diffRows(baseline.inventory?.rows ?? [], candidate.inventory?.rows ?? []),
    binDiff: diffStrings(baseline.binShims, candidate.binShims),
  };
}

/** @param {unknown[]} baseline @param {unknown[]} candidate */
function diffRows(baseline, candidate) {
  const before = new Set(baseline.map((row) => stableJson(row)));
  const after = new Set(candidate.map((row) => stableJson(row)));
  const onlyBaseline = [...before].filter((row) => !after.has(row));
  const onlyCandidate = [...after].filter((row) => !before.has(row));
  return {
    onlyBaseline: onlyBaseline.slice(0, 200).map((row) => JSON.parse(row)),
    onlyCandidate: onlyCandidate.slice(0, 200).map((row) => JSON.parse(row)),
    totalOnlyBaseline: onlyBaseline.length,
    totalOnlyCandidate: onlyCandidate.length,
    truncated: onlyBaseline.length > 200 || onlyCandidate.length > 200,
  };
}

/** @param {string[]} baseline @param {string[]} candidate */
function diffStrings(baseline, candidate) {
  return {
    onlyBaseline: baseline.filter((value) => !candidate.includes(value)),
    onlyCandidate: candidate.filter((value) => !baseline.includes(value)),
  };
}

/** @param {string} verdict @param {'regression'|'review'|'never'} failOn */
export function shouldFail(verdict, failOn) {
  if (failOn === 'never') return false;
  if (failOn === 'regression') return verdict === 'REGRESSION';
  return ['REGRESSION', 'REVIEW', 'INCONCLUSIVE'].includes(verdict);
}
