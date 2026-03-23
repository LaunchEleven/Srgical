# Distribution Guide

## Current Production Channel

The current production release channel is `npm`. A tagged release should always produce an npm-ready tarball, validate
the built CLI, and attach the resulting artifact metadata to the release.

The npm package does not bundle `codex` or `claude`. Users still need at least one supported local agent CLI installed
separately and available on `PATH`, and `srgical doctor` remains the truthful way to confirm which agents are usable on
the current machine.

## Release Flow

1. Bump the version in `package.json`.
2. Tag the release as `v<version>`.
3. Let the GitHub release workflow run `npm ci`, `npm run release:pack`, and attach the generated tarball plus release
   manifest.
4. If `NPM_TOKEN` is configured, publish the same version to `npm`.

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
npm install -g srgical
```

- Required local prerequisites after install:
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
