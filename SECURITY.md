# Security policy and threat boundary

## Supported version

V0.1 is under validation and has not yet been declared a stable security-supported release.

## Threat model

The input repository and dependency metadata may be malformed or hostile. V0.1 therefore:

- confines config, project, and report paths to a trusted working directory;
- rejects absolute paths, `..` traversal, source symlinks, Git/SSH/HTTP dependency specs, private registry configuration, authenticated or query-bearing lockfile URLs, repository `.npmrc`, executable pnpm hooks, pnpm config/package-manager dependencies, runtime switching, and workspace registry routing;
- copies the project into two tool-owned temporary roots and never mounts the original project;
- maps a non-root host UID/GID into the container;
- uses a read-only container root filesystem, drops all capabilities, sets no-new-privileges, bounds PIDs/memory/CPU, and mounts only the current leg's copied project and cold cache;
- does not mount the host home directory, SSH/AWS/Docker credential directories, Git credentials, Docker socket, parent environment, or secrets;
- forces `--ignore-scripts` for the tested project; pnpm also forces `--config.ignore-pnpmfile=true`, disables project package-manager redirection, and includes the workspace root in recursive inventory;
- bootstraps the exact manager in a separate container that mounts only a temporary manager directory. npm bootstrap scripts stay disabled; pnpm package bootstrap scripts may run because pnpm 12 installs its native binary that way. The tested project is never mounted during bootstrap. Later project phases mount the manager directory read-only and use a separate writable cache/store;
- force-removes and re-inspects timed-out containers before returning;
- recursively redacts reports and escapes workflow-command-shaped log lines.

## Important residual risks

- npm/pnpm and archive extractors still parse untrusted metadata and packages. Container isolation reduces impact but is not a formal sandbox.
- Docker daemon access is a privileged host capability. Use a disposable GitHub-hosted runner or an equivalently disposable environment for untrusted repositories.
- The container has ordinary outbound network access. V0.1 does not implement a registry-only egress proxy.
- Public registry packages can change at mutable URLs despite lockfile integrity controls. The receipt records the image digest and exact manager versions but cannot make third-party infrastructure deterministic.
- V0.1 deliberately refuses `.npmrc`, private registries, source symlinks, and custom pnpm hooks instead of silently changing their semantics.
- pnpm versions below 10.34.2 or 11.5.3 in their respective major lines are refused. Repository `configDependencies` and `packageManagerDependencies` are refused even on patched versions because V0.1 does not need those execution paths.
- Repository-controlled pnpm path relocation (`modulesDir`, virtual/global store, cache/state, lockfile/global/bin directories) is refused so project materialization cannot overwrite the read-only manager boundary.

## GitHub Actions

- Default permission: `contents: read` only.
- Checkout must use `persist-credentials: false`.
- Never execute pull-request content through `pull_request_target`.
- Do not inject repository or organization secrets into this Action or its containers.
- Do not use a persistent self-hosted runner for untrusted pull requests.
- V0.1 does not comment on PRs or upload SARIF, so it needs no write permission.
- Raw install diagnostics are excluded from the GitHub step summary and remain only in the redacted receipt artifact.

Relevant upstream advisories: [repository-selected pacquet engine](https://github.com/pnpm/pnpm/security/advisories/GHSA-gj8w-mvpf-x27x) and [env-lockfile package-manager bytes](https://github.com/pnpm/pnpm/security/advisories/GHSA-w466-c33r-3gjp).

## Reporting a vulnerability

Open a private GitHub security advisory after the public repository exists. Before that, report privately to the repository owner. Do not include live credentials, private lockfiles, or proprietary dependency names in a public issue.
