# Validation record

Validation date: 2026-08-18 (Asia/Shanghai)

## Current conclusion

Local candidate gate: **PASS**.

Real Linux Docker goldens: **partially proven, not yet green as a complete run**. The third private run proved the three Node release gates, committed Action before build, real timeout cleanup, real protected-file mutation, CJS CLI, and npm workspace PASS/PASS. pnpm 11 baseline also passed with a complete non-empty workspace tree; pnpm 12 could not bootstrap because its official package requires its own install script to replace a placeholder with the native binary. Exact managers are now bootstrapped in a separate projectless container, while tested-project scripts remain disabled. A fourth Linux run is required. This file must not be read as evidence of a public release, Marketplace listing, or external adoption.

## Local gate

Environment: macOS arm64, Node.js 25.3.0, npm 11.7.0.

- Strict JS type checking: PASS.
- JavaScript syntax scan: PASS across 35 source, script, and test files.
- Automated tests: 40/40 PASS.
- Test-presence guard: PASS, 5 files and 32 static declarations (parameterized tests expand to 40 runtime cases).
- Result branches covered: no regression, deterministic candidate failure, network inconclusive, timeout, protected-file mutation, and logical-tree difference.
- Path traversal, output symlink escape, source symlink, `.npmrc`, credential URL, nested override Git spec, and out-of-root local dependency rejection: PASS.
- Secret/path redaction and workflow-command escaping: PASS.
- Non-root/read-only/cap-drop/no-new-privileges/resource-bound Docker argv assertions: PASS.
- npm/pnpm ignore-scripts, pnpm ignore-pnpmfile, recursive workspace-root inventory, and separate bootstrap/project-cache assertions: PASS.
- Projectless exact-manager bootstrap: PASS in local argv/mount tests; pnpm's own bootstrap script is allowed only in that projectless container.
- Manager/project cache separation and read-only manager mount during project phases: PASS; pnpm path-relocation settings are refused.
- Recursive/self-referential YAML alias handling: controlled BoundaryError, not stack overflow.
- package.json versus package-lock root metadata: PASS, including the CJS bin path.
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
