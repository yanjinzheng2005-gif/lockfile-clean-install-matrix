# Lockfile Clean Install Matrix

Prove whether the same committed npm or pnpm lockfile still cold-installs when the package-manager version changes.

The tool runs the baseline and candidate in separate Linux/amd64 containers, forces the public npm registry, disables lifecycle scripts and pnpm hooks, detects protected-file mutations, normalizes each manager's logical dependency inventory, and writes one JSON receipt plus one Markdown receipt.

## Status

V0.1 is a validation candidate. The local release gate passes, but the real Linux Docker goldens and public release gate must pass before this repository is tagged or listed in GitHub Marketplace.

## What V0.1 does

- npm and pnpm, one manager per run.
- One exact baseline version and one exact candidate version.
- Exact Node image tag, Linux/amd64 only.
- Separate project copy, manager-bootstrap cache, project cache/store, temporary directory, and container for each leg.
- `npm ci` or `pnpm install --frozen-lockfile`.
- Project lifecycle scripts disabled in both CLI arguments and container environment.
- Exact package managers bootstrapped in a separate projectless container. pnpm's own package bootstrap script is allowed there because pnpm 12 uses it to install its native binary; that container receives no project mount or host secrets. Later project phases mount the manager directory read-only and use a different writable project cache/store.
- pnpm file hooks refused at preflight and disabled again at execution.
- Project-requested package-manager switching is disabled (`pmOnFail=ignore` on pnpm 11/12; the legacy switch is disabled on pnpm 10), so both legs keep using their requested exact versions even when `packageManager` pins another pnpm release.
- Install success, deterministic failure, timeout, protected-file mutation, network uncertainty, logical dependency inventory, and bin-shim comparison.
- JSON and Markdown receipts from the same result object.

## What V0.1 does not do

- It does not compare npm against pnpm. It compares two versions of the same manager.
- It does not run application tests, builds, vulnerability scans, or license scans.
- It does not update or repair a lockfile.
- It does not support private registries, repository `.npmrc` files, Git dependencies, source symlinks, custom pnpm hooks, pnpm `configDependencies`/`packageManagerDependencies`, repository-controlled runtime switching, pnpm workspace registry routing, or path relocation such as `modulesDir`, `virtualStoreDir`, and `storeDir`.
- It does not promise full network isolation. The container retains ordinary outbound access so the public npm registry and its tarballs can be reached.
- It does not make Docker a perfect sandbox. Do not run untrusted pull-request code on a persistent self-hosted runner.
- It trusts the exact public npm/pnpm manager package enough to bootstrap it inside a projectless restricted container. A registry compromise remains a supply-chain risk, but the bootstrap cannot read the tested project or host credentials.

## Requirements

- Node.js 20.10 or later for the wrapper.
- A local Linux Docker engine.
- A non-root POSIX host user. The same numeric user and group are used in the container.
- A config file and project path contained in the current working directory.
- pnpm 10.34.2+, pnpm 11.5.3+, or pnpm 12+. Older lines and prereleases at the security-floor versions are refused because published pnpm advisories cover repository-controlled pre-script execution paths.

## CLI

Build and run from a checkout:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.cjs run --config examples/lockfile-matrix.example.json --fail-on review
```

Config fields:

```json
{
  "schemaVersion": 1,
  "projectPath": ".",
  "manager": "npm",
  "baselineVersion": "11.14.1",
  "candidateVersion": "11.16.0",
  "nodeVersion": "24.16.0",
  "timeoutSeconds": 300,
  "outputDir": "lockfile-matrix-results"
}
```

`projectPath` and `outputDir` must be relative and cannot contain `..`. Put the config at the root of the repository being checked when using `projectPath: "."`.

`--fail-on` defaults to `review` and accepts:

- `regression`: fail only when the baseline passes and the candidate deterministically fails, hangs, or mutates protected files.
- `review`: also fail on dependency-tree/bin differences or an inconclusive result.
- `never`: always write evidence without failing for the verdict. Usage, boundary, environment, and internal errors still fail.

## Verdicts

| Verdict | Meaning |
|---|---|
| `NO_REGRESSION` | Both cold installs passed with the same normalized logical tree and bin set. |
| `REGRESSION` | The baseline passed and the candidate failed, timed out, or changed protected files. |
| `REVIEW` | Both passed, but the normalized dependency tree or bin set changed. |
| `IMPROVEMENT` | The candidate passed while the baseline deterministically did not. |
| `INCONCLUSIVE` | Network noise, inventory failure, baseline failure, environment failure, or concurrent source mutation prevents a reliable comparison. |

## GitHub Action

The bundled Action requires Docker and only needs `contents: read`. Do not use `pull_request_target` to execute pull-request content. Until a validated release tag exists, exercise it from a checkout with `uses: ./` as the repository CI does.

The inventory evidence limit is 16 MiB per leg. Exceeding it produces `INVENTORY_INCONCLUSIVE`; truncated JSON is never treated as a passing tree.

## Evidence boundary

A green receipt means two exact manager versions cold-installed the copied project under the stated image and restrictions. It is not evidence that every OS, architecture, registry, lifecycle-script path, native build, or application behavior is compatible.

The authoritative red golden is pnpm 11.17.0 versus pnpm 12.0.0-beta.0 in the pinned minimal Node image, where pnpm 12's native network client cannot load a system CA bundle that the image does not contain. A no-symlink adaptation of [npm/cli#9433](https://github.com/npm/cli/issues/9433) did not reproduce the issue and is retained only as rejected research history. The pnpm preflight floor and repository-config refusals account for [GHSA-gj8w-mvpf-x27x](https://github.com/pnpm/pnpm/security/advisories/GHSA-gj8w-mvpf-x27x) and [GHSA-w466-c33r-3gjp](https://github.com/pnpm/pnpm/security/advisories/GHSA-w466-c33r-3gjp). Real Linux validation, current limitations, and exact gate results are recorded in [VALIDATION.md](VALIDATION.md).

## Development

```sh
npm ci --ignore-scripts
npm run test:release
```

See [SECURITY.md](SECURITY.md) before widening any input, registry, hook, mount, or Action-permission boundary.
