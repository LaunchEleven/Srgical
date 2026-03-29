import process from "node:process";
import { isPlaceholderChangelog, readInstalledPackageInfo, readLocalChangelog } from "../core/package-info";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";

export function runChangelogCommand(): void {
  process.stdout.write(`${renderChangelogSummary()}\n`);
}

export function renderChangelogSummary(): string {
  const info = readInstalledPackageInfo();
  const changelog = readLocalChangelog();
  const placeholder = isPlaceholderChangelog(changelog);

  return [
    ...renderCommandBanner("srgical", "changelog"),
    "",
    renderSectionHeading("Release Context"),
    `Installed version: ${info.version}`,
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    info.releasesUrl ? `All releases: ${info.releasesUrl}` : null,
    "",
    renderSectionHeading("Local Notes"),
    placeholder
      ? "Local package changelog is currently minimal. Use the release notes URL above for the detailed upgrade notes."
      : "Local CHANGELOG.md:",
    !placeholder && changelog ? changelog : null,
    "",
    renderSectionHeading("Next"),
    paintLine("Tip: run `srgical version` to confirm exactly which release is installed.", "brand", { bold: true })
  ]
    .filter((line) => line !== null)
    .join("\n");
}
