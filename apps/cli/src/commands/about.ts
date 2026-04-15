import process from "node:process";
import { getSupportedAgentAdapters } from "../core/agent";
import { readInstalledPackageInfo } from "../core/package-info";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";

export function runAboutCommand(): void {
  process.stdout.write(`${renderAboutSummary()}\n`);
}

export function renderAboutSummary(): string {
  const info = readInstalledPackageInfo();
  const supportedAgents = getSupportedAgentAdapters().map((adapter) => adapter.id).join(", ");

  return [
    ...renderCommandBanner("srgical", "about"),
    "",
    renderSectionHeading("Package"),
    "srgical",
    `Version: ${info.version}`,
    `Package: ${info.name}`,
    `Description: ${info.description}`,
    info.homepage ? `Homepage: ${info.homepage}` : null,
    info.repositoryUrl ? `Repository: ${info.repositoryUrl}` : null,
    info.issuesUrl ? `Issues: ${info.issuesUrl}` : null,
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    info.releasesUrl ? `All releases: ${info.releasesUrl}` : null,
    "",
    renderSectionHeading("Agents"),
    `Supported agents: ${supportedAgents || "none registered"}`,
    "",
    renderSectionHeading("Next"),
    paintLine("Next steps: `srgical prepare <id>`, `srgical operate <id>`, `srgical status [id]`, or `srgical changelog`", "brand", {
      bold: true
    })
  ]
    .filter(Boolean)
    .join("\n");
}
