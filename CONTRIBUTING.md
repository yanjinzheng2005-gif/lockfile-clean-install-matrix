# Contributing

1. Keep V0.1 limited to npm/pnpm, same-manager baseline versus candidate, and Linux/amd64 cold installs.
2. Do not add arbitrary commands, private-registry credentials, lifecycle-script execution, host mounts, Action write permissions, or a broader network claim without a separate design and security review.
3. Install development dependencies with `npm ci --ignore-scripts`.
4. Run `npm run test:release` before submitting a change.
5. When container behavior changes, also run the real Linux npm pass, pnpm pass, and npm regression goldens.
6. Update source and committed `dist/` together.

Bug reports should include the public repository/commit when possible, exact Node and manager versions, the receipt with secrets removed, and whether the failure reproduces outside this tool.
