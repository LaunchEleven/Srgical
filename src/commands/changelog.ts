import process from "node:process";
import { isPlaceholderChangelog, readInstalledPackageInfo, readLocalChangelog } from "../core/package-info";

export function runChangelogCommand(): void {
  process.stdout.write(`${renderChangelogSummary()}\n`);
}

export function renderChangelogSummary(): string {
  const info = readInstalledPackageInfo();
  const changelog = readLocalChangelog();
  const placeholder = isPlaceholderChangelog(changelog);

  return [
    `Installed version: ${info.version}`,
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    info.releasesUrl ? `All releases: ${info.releasesUrl}` : null,
    "",
    placeholder
      ? "Local package changelog is currently minimal. Use the release notes URL above for the detailed upgrade notes."
      : "Local CHANGELOG.md:",
    !placeholder && changelog ? changelog : null
  ]
    .filter((line) => line !== null)
    .join("\n");
}
