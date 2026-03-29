import process from "node:process";
import { readInstalledPackageInfo } from "../core/package-info";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";

export function runVersionCommand(): void {
  process.stdout.write(`${renderVersionSummary()}\n`);
}

export function renderVersionSummary(): string {
  const info = readInstalledPackageInfo();

  return [
    ...renderCommandBanner("srgical", "version"),
    "",
    renderSectionHeading("Installed"),
    `srgical ${info.version}`,
    info.description,
    `Package: ${info.name}`,
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    info.releasesUrl ? `All releases: ${info.releasesUrl}` : null,
    "",
    renderSectionHeading("Next"),
    paintLine("More: run `srgical about`", "brand", { bold: true })
  ]
    .filter(Boolean)
    .join("\n");
}
