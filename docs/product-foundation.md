# Product Foundation

## Source Pattern

The system in `Writr\migrations-part-5` has four durable primitives:

1. `01`: a stable high-level plan
2. `02`: a current-context kickoff and handoff log
3. `03`: a detailed step tracker with strict progression rules
4. `04`: a repeatable next-agent prompt that forces disciplined continuation

That pattern is the product.

## Product Thesis

Teams should be able to run one command, enter a planning studio, talk with an AI until the approach is ready, write a
tracker pack into the repo, and then keep executing the next valid chunk without manually reconstructing state each
time.

## Non-Negotiables

- Local-first by default
- Agent actions remain explicit
- The workflow is markdown-first and repo-visible
- Execution must be incremental, resumable, and validation-aware
- The UI cannot feel like a boring debug console

## V1 Scope

- Three launch-scope agent adapters: `codex`, `claude`, and `augment`
- One planning-pack format under `.srgical/`
- One full-screen TUI for planning conversation
- One execution command that runs the current next-step prompt through the active workspace agent
- Truthful installed-tool detection plus session-scoped active-agent selection

## V1 Success Criteria

- A new repo can be bootstrapped without manual prompt copy-paste
- The user can plan inside a dedicated interface instead of a raw shell
- The generated pack is close enough to the existing Writr-style system that it feels familiar
- The user can trigger the next execution loop with a single command
- The product reports missing supported agents honestly and lets the user choose the active local tool when more than
  one is installed

## Distribution Strategy

- Native packages: GitHub Packages as `@launcheleven/srgical` and npm public as `@launch11/srgical`
- Versioning model: semver via git tags on GitHub Actions, with `package.json` carrying the base major/minor line
- Release artifacts: standalone binaries for Windows, macOS, and Linux
- Package-manager wrappers: `brew`, `choco`, and other ecosystems can install those release artifacts
