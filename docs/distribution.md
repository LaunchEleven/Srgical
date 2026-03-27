# Distribution Guide

## Current Production Channel

The current production release channel is GitHub Packages for npm. Every `main` push should produce a uniquely versioned
package, validate the built CLI, and publish the same tarball that was packed in CI.

The npm package does not bundle `codex` or `claude`. Users still need at least one supported local agent CLI installed
separately and available on `PATH`, and `srgical doctor` remains the truthful way to confirm which agents are usable on
the current machine.

## Release Flow

1. The workflow filename carries the `major.minor` line, currently `build-and-publish-github-packages-v0.1.yml`.
2. CI extracts `0.1` from that filename and uses `github.run_number` as the patch number.
3. The workflow runs `npm ci`, stamps `package.json` with `npm version --no-git-tag-version`, runs `npm test`, then
   runs `npm run release:pack`.
4. Pushes to `main` publish the computed version to GitHub Packages with `GITHUB_TOKEN`.
5. Pull requests run the same build and pack flow, but get a `-pull-request.<number>` suffix and do not publish.

To bump the release line from `0.1.x` to `0.2.x`, rename the workflow file and workflow title to the new `v0.2`
prefix. That naturally resets the patch sequence because the next published version line starts at the new
`major.minor`.

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

GitHub Packages only supports scoped npm package names. This package now publishes as `@launcheleven/srgical`.

The repo-local `.npmrc` pins that scope to GitHub Packages:

```ini
@launcheleven:registry=https://npm.pkg.github.com
```

The workflow publishes with `GITHUB_TOKEN`, which GitHub documents as the recommended authentication path for packages
associated with the workflow repository. Local installs and local publishes still require authentication in the user's
own npm config, typically:

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
