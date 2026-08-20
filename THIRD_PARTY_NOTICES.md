# Third-party notices

The runtime bundle uses Node.js built-in modules and bundles `yaml` 2.9.0 under the ISC license so pnpm workspace and lock files can be parsed structurally before execution.

Development/build dependencies:

- TypeScript — Apache-2.0.
- esbuild and its platform packages — MIT.
- `@types/node` and `undici-types` — MIT.
- Ajv and its supporting packages — MIT, except `fast-uri` (BSD-3-Clause). Ajv is development-only and validates committed schemas in the release gate.

External tools selected at runtime are not redistributed by this repository:

- Node.js and the official Node container image — Node.js project licensing applies; the npm registry currently reports the Node package as MIT.
- npm 11.14.1 and 11.16.0 fixtures — Artistic-2.0.
- pnpm 11.17.0 and 12.0.0-beta.0 fixtures — the published npm packages report MIT.
- Docker Engine/CLI and GitHub-hosted runner images — their own distribution terms apply.
- GitHub Actions used by CI are invoked by immutable commit SHA and are not copied into this repository.

The rejected npm reproduction attempt is independently adapted from factual steps in npm/cli#9433; no npm source code is copied, and the adaptation is not claimed as a reproduced regression.

Run `npm run license:check` after every dependency update. This file must be re-reviewed before a release when fixed manager or image versions change.

## yaml license notice

Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
