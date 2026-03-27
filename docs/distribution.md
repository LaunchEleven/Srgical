# Distribution Guide

## Current Production Channel

The current production release channel is GitHub Packages for npm, paired with GitHub Releases. Versioning is source-controlled with Changesets,
which means semver intent lives in pull requests instead of being inferred from CI build numbers.

The npm package does not bundle `codex` or `claude`. Users still need at least one supported local agent CLI installed
separately and available on `PATH`, and `srgical doctor` remains the truthful way to confirm which agents are usable on
the current machine.

## Release Flow

1. A feature branch that changes the package also adds a changeset with `npm run changeset`.
2. When that branch lands on `main`, the release workflow runs `npm ci`, `npm test`, and `npm run version-packages`.
3. If the changesets produce a version bump, the workflow commits the updated `package.json`, `CHANGELOG.md`, and
   consumed changeset files back to `main`.
4. The same workflow run then executes `npm run release`, which packs the tarball and publishes the version already
   written into `package.json` to GitHub Packages.
5. After publish, the workflow creates a `v<version>` tag and a GitHub Release with the packaged artifacts attached.

This keeps the published semver repeatable across reruns and tracked in git history instead of being tied to a specific
Actions run number, without requiring a separate release PR just to ship the version bump.

## Local Release Check

Run this from the repo root:

```bash
npm run release:pack
```

That command:

- builds the TypeScript CLI,
- runs `node dist/index.js doctor`,
- creates an npm tarball under `.artifacts/release/`,
- writes `release-manifest.json` and `release-manifest.md` with the artifact path and SHA256 hash.

## Registry Configuration

GitHub Packages only supports scoped npm package names. This package publishes as `@launcheleven/srgical`.

The repo-local `.npmrc` pins that scope to GitHub Packages:

```ini
@launcheleven:registry=https://npm.pkg.github.com
```

The workflow publishes with `GITHUB_TOKEN`, which GitHub supports for packages associated with the workflow repository.
Local installs and local publishes still require authentication in the user's own npm config:

```ini
//npm.pkg.github.com/:_authToken=TOKEN
@launcheleven:registry=https://npm.pkg.github.com
```

## Post-Install Setup

After installing the package, run:

```bash
srgical doctor
```

That verifies the workspace state, shows the active agent, and reports whether `codex` and `claude` are locally
available or missing.

## Artifact Strategy

### npm

- Source of truth for the first production install path.
- Install target once published:

```bash
npm install -g @launcheleven/srgical
```

- Required local prerequisites after install:
  - authenticated access to GitHub Packages
  - `codex` and/or `claude` installed separately
  - available on `PATH` for the current shell session

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
