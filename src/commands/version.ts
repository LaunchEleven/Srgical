import process from "node:process";
import { readInstalledPackageInfo } from "../core/package-info";

export function runVersionCommand(): void {
  process.stdout.write(`${renderVersionSummary()}\n`);
}

export function renderVersionSummary(): string {
  const info = readInstalledPackageInfo();

  return [
    `srgical ${info.version}`,
    info.description,
    `Package: ${info.name}`,
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    info.releasesUrl ? `All releases: ${info.releasesUrl}` : null,
    "More: run `srgical about`"
  ]
    .filter(Boolean)
    .join("\n");
}
