# Validation record

Validation date: 2026-08-18 (Asia/Shanghai)

## Current conclusion

Local candidate gate: **PASS**. Private GitHub-hosted Linux gate: **PASS**.

Run [32337920436](https://github.com/yanjinzheng2005-gif/lockfile-clean-install-matrix/actions/runs/32337920436) completed successfully for fixed commit `26ad446b07a324113da6c2e7314c8e83000ec278`. It passed Node 20/22/24 release gates, the committed Action before any build, real timeout/removal and mutation probes, npm and pnpm green workspace matrices, and the expected pnpm 12 minimal-image CA red matrix. This is engineering evidence, not evidence of a public release, Marketplace listing, or external adoption.

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
- pnpm project-driven version switching: disabled per major line; repository `pmOnFail`/runtime fallbacks are refused, and the fixture deliberately pins a different pnpm version.
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

## Real Linux gate result

The private GitHub-hosted runner proved all of the following:

1. npm workspace pass fixture: root and child dependencies present; baseline PASS, candidate PASS, overall NO_REGRESSION.
2. pnpm workspace pass fixture: root and child dependencies present; baseline PASS, candidate PASS, overall NO_REGRESSION.
3. pnpm 11.17.0 versus pnpm 12.0.0-beta.0 in the pinned minimal image: baseline PASS, candidate INSTALL_FAILED because the image lacks a system CA bundle, overall REGRESSION.
4. Lifecycle sentinel never executes in any tested-project leg.
5. The committed packaged Action, exercised before any workflow build, produces the same npm pass result.
6. A real container times out, is forcibly removed, and is confirmed absent.
7. A real isolated container mutation is detected as a protected-file diff.
8. Every normal, failed, and timed-out container is removed.

Real run `32337356424` proved that the no-symlink npm/cli#9433 adaptation did not reproduce the published result. It is excluded from release assertions and may only be described as rejected research history.

Authoritative artifact: `linux-cold-install-receipts`, artifact ID `9395305509`, 11,258 bytes.

- npm green JSON SHA-256: `885f471b0c6d677dce5069c873cdab0733767fb25f7dbd2875641debb6a89417`
- pnpm green JSON SHA-256: `7104308836001b7cde98b5fc305c4aabec8894d7e917fee55fe5d2ed4f932892`
- pnpm 12 red JSON SHA-256: `51b999d5882a2298eabcea5c5cfc0a97379ed127e657ef27369e53ab75009c29`
- Docker boundary probe SHA-256: `c6f6ef23fde17053e116ae1f25eb5eeeb2fb14efa38088381dc7157a6ff436ed`

All three receipts record `sourceUnchanged: true`. A targeted scan found no host path, GitHub/npm token, authorization header, or lifecycle sentinel leak.

## Evidence boundary

Local fake-Docker tests validate orchestration, classification, mutation detection, reports, and safety arguments. The real Linux run closes Docker behavior, manager flags, pinned image, workspace trees, timeout removal, mutation, and red/green oracle execution. It does not prove every repository, OS, registry, or network condition.

External user feedback: 0. Repository visibility: private validation only. Public repository: not available. Release/tag: not created. Marketplace: not listed. Community launch: not performed.
