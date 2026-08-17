# Validation record

Validation date: 2026-08-18 (Asia/Shanghai)

## Current conclusion

Local candidate gate: **PASS**.

Real Linux Docker goldens: **partially proven, not yet green as a complete run**. The second private run proved the three Node release gates, the committed Action before build, real timeout cleanup, and real protected-file mutation. The CLI then failed before its npm golden because an ESM bundle could not load YAML's CommonJS path. The CLI has been moved to a CJS entrypoint; a new Linux run is required. This file must not be read as evidence of a public release, Marketplace listing, or external adoption.

## Local gate

Environment: macOS arm64, Node.js 25.3.0, npm 11.7.0.

- Strict JS type checking: PASS.
- JavaScript syntax scan: PASS across 34 source, script, and test files.
- Automated tests: 38/38 PASS.
- Test-presence guard: PASS, 5 files and 30 static declarations (parameterized tests expand to 38 runtime cases).
- Result branches covered: no regression, deterministic candidate failure, network inconclusive, timeout, protected-file mutation, and logical-tree difference.
- Path traversal, output symlink escape, source symlink, `.npmrc`, credential URL, nested override Git spec, and out-of-root local dependency rejection: PASS.
- Secret/path redaction and workflow-command escaping: PASS.
- Non-root/read-only/cap-drop/no-new-privileges/resource-bound Docker argv assertions: PASS.
- npm/pnpm ignore-scripts, pnpm ignore-pnpmfile, recursive workspace-root inventory, and separate bootstrap/project-cache assertions: PASS.
- npm shrinkwrap priority, dual-lock rejection, escaped JSON URL, structured pnpm YAML, config/package-manager dependencies, duplicate YAML keys, private registry routing, and pnpm security-floor assertions: PASS.
- Timeout cleanup ordering and tool-owned temporary-directory deletion guard: PASS.
- JSON/Markdown common verdict and original-source unchanged assertions: PASS.
- Action input/output and step-summary smoke test: PASS.
- Dependency license allowlist: PASS.
- Dist content and deterministic rebuild: PASS.
- Committed `dist/` versus source-built result: PASS in a clean local Git worktree.
- Workflow permission and container boundary scan: PASS.
- JSON Schema validation for example config and generated receipt: PASS.

## Real Linux release blockers

CI must still prove all of the following on a real GitHub-hosted Linux runner:

1. npm workspace pass fixture: root and child dependencies present; baseline PASS, candidate PASS, overall NO_REGRESSION.
2. pnpm workspace pass fixture: root and child dependencies present; baseline PASS, candidate PASS, overall NO_REGRESSION.
3. npm/cli#9433 adaptation: npm 11.14.1 baseline PASS, npm 11.16.0 candidate INSTALL_FAILED, overall REGRESSION.
4. Lifecycle sentinel never executes in any leg.
5. The committed packaged Action, exercised before any workflow build, produces the same npm pass result.
6. A real container times out, is forcibly removed, and is confirmed absent.
7. A real isolated container mutation is detected as a protected-file diff.
8. Every normal, failed, and timed-out container is removed.

If the no-symlink adaptation of npm/cli#9433 does not reproduce the published result, it must be replaced or described only as a controlled fixture; it must not be marketed as a reproduced public regression.

## Evidence boundary

Local fake-Docker tests validate orchestration, classification, mutation detection, reports, and safety arguments. They do not prove Docker behavior, actual manager flags, Node image availability, or the public regression. Only the real Linux job can close those items.

External user feedback: 0. Repository visibility: private validation only. Public repository: not available. Release/tag: not created. Marketplace: not listed. Community launch: not performed.
