# Changesets

Add a changeset whenever a pull request should affect the published package version or changelog.

```bash
npm run changeset
```

Merging changesets to `main` lets the release workflow open or update a release PR. Merging that release PR publishes
the next package version to GitHub Packages.
