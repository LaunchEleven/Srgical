# Distribution Guide

## Current Production Channel

The current production release channels are GitHub Packages for npm, the public npm registry, and GitHub Releases.
Versioning is tag-driven from git history, which means the repo carries a base major/minor line and CI computes the
next patch version during release instead of committing a version bump back to `main`.

The npm package bundles the native Codex and Claude SDK runtimes used by Studio. Users configure a supported provider
authentication route in the browser settings. Optional legacy agent adapters may still be detected by the backend, but
they are not a separate terminal product surface.

## Release Flow

1. `package.json` stores the release line, such as `0.0.0` or `0.1.0`.
2. When a commit lands on `main`, the release workflow runs `npm ci` and `npm test`.
3. CI reads the base version, looks for existing `v<major>.<minor>.*` tags, and computes the next patch version for
   the current untagged commit.
4. The workflow stages that computed version into temporary package copies without mutating the committed repo files.
5. The same workflow publishes `@launcheleven/srgical` to GitHub Packages and `@launch11/srgical` to the public npm
   registry.
6. After both publishes succeed, the workflow creates a `v<version>` tag and a GitHub Release with the packaged
   artifacts attached.

This keeps the published semver repeatable for a given commit, avoids commit-noise from release-only version bumps, and
still gives each published package a unique version that both registries can accept.

## Local Release Check

Run this from the repo root:

```bash
npm run release:pack
```

That command:

- builds the local browser host and Studio assets,
- runs the automated test suite,
- computes the next release version from git tags,
- creates GitHub Packages and npm tarballs under `.artifacts/release/`,
- writes `release-manifest.json` and `release-manifest.md` with the artifact paths and SHA256 hashes.

## Registry Configuration

GitHub Packages only supports scoped npm package names. This repo publishes two package names from the same source:

- `@launcheleven/srgical` on GitHub Packages
- `@launch11/srgical` on the public npm registry

The repo-local `.npmrc` pins that scope to GitHub Packages:

```ini
@launcheleven:registry=https://npm.pkg.github.com
```

The workflow publishes the GitHub package with `GITHUB_TOKEN`, which GitHub supports for packages associated with the
workflow repository. The npm public package uses the repository secret `NPM_TOKEN`. Local installs and local publishes
still require authentication in the user's own npm config:

```ini
//npm.pkg.github.com/:_authToken=TOKEN
@launcheleven:registry=https://npm.pkg.github.com
```

```ini
//registry.npmjs.org/:_authToken=TOKEN
@launch11:registry=https://registry.npmjs.org
```

## Post-Install Setup

After installing the package, run:

```bash
srgical
```

Studio opens the last working directory. Its settings page reports provider authentication and connector readiness;
the conversation header reports the selected provider model.

## Artifact Strategy

### npm

- Source of truth for the first production install path.
- Install target once published:

```bash
npm install -g @launcheleven/srgical
```

```bash
npm install -g @launch11/srgical
```

- Required local prerequisites after install:
  - authenticated access to GitHub Packages
  - a supported Codex or Claude authentication route configured in Studio

- Local install smoke test from a generated tarball:

```bash
npm install -g ./.artifacts/release/<tarball-name>.tgz
```

### Standalone Binaries

- Not implemented in this step.
- Defined path: build Windows, macOS, and Linux binaries from tagged releases once the Node-based CLI workflow is
  stable enough to freeze into a single-file artifact.
- Those binaries should be uploaded to GitHub Releases next to the npm tarball so they remain version-aligned.

### Wrapper Package Managers

- Not implemented in this step.
- Defined path: `brew`, `choco`, and similar wrappers should install versioned GitHub Release artifacts instead of
  rebuilding from source in each ecosystem.
- That keeps wrapper packages thin and aligned with the exact tested release outputs.

## Release Inputs

The published npm package should include:

- `dist/`
- `README.md`
- `docs/`
- `LICENSE`

The production entrypoint remains the `srgical` bin mapped to `dist/index.js`.
