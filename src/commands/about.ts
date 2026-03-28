import process from "node:process";
import { getSupportedAgentAdapters } from "../core/agent";
import { readInstalledPackageInfo } from "../core/package-info";

export function runAboutCommand(): void {
  process.stdout.write(`${renderAboutSummary()}\n`);
}

export function renderAboutSummary(): string {
  const info = readInstalledPackageInfo();
  const supportedAgents = getSupportedAgentAdapters().map((adapter) => adapter.id).join(", ");

  return [
    "srgical",
    `Version: ${info.version}`,
    `Package: ${info.name}`,
    `Description: ${info.description}`,
    info.homepage ? `Homepage: ${info.homepage}` : null,
    info.repositoryUrl ? `Repository: ${info.repositoryUrl}` : null,
    info.issuesUrl ? `Issues: ${info.issuesUrl}` : null,
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    info.releasesUrl ? `All releases: ${info.releasesUrl}` : null,
    `Supported agents: ${supportedAgents || "none registered"}`,
    "Next steps: `srgical doctor`, `srgical studio`, or `srgical changelog`"
  ]
    .filter(Boolean)
    .join("\n");
}
