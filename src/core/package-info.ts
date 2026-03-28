import { readFileSync } from "node:fs";
import path from "node:path";

export type InstalledPackageInfo = {
  packageRoot: string;
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repositoryUrl?: string;
  issuesUrl?: string;
  releasesUrl?: string;
  releaseNotesUrl?: string;
  changelogPath: string;
};

type RawPackageJson = {
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  bugs?: {
    url?: string;
  };
  repository?:
    | string
    | {
        type?: string;
        url?: string;
      };
};

export function readInstalledPackageInfo(): InstalledPackageInfo {
  const packageRoot = resolvePackageRoot();
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as RawPackageJson;
  const repositoryUrl = normalizeRepositoryUrl(packageJson.repository);
  const releasesUrl = repositoryUrl ? `${repositoryUrl}/releases` : undefined;
  const version = packageJson.version ?? "0.0.0";

  return {
    packageRoot,
    name: packageJson.name ?? "srgical",
    version,
    description: packageJson.description ?? "Local-first AI planning and execution orchestration.",
    homepage: packageJson.homepage,
    repositoryUrl,
    issuesUrl: packageJson.bugs?.url,
    releasesUrl,
    releaseNotesUrl: releasesUrl ? `${releasesUrl}/tag/v${version}` : undefined,
    changelogPath: path.join(packageRoot, "CHANGELOG.md")
  };
}

export function readLocalChangelog(): string | null {
  const info = readInstalledPackageInfo();

  try {
    return readFileSync(info.changelogPath, "utf8").trim();
  } catch {
    return null;
  }
}

export function isPlaceholderChangelog(content: string | null): boolean {
  if (!content) {
    return true;
  }

  const normalized = content.replace(/\r\n/g, "\n").trim();
  return (
    normalized ===
    "# Changelog\n\nRelease history is tracked through git tags, GitHub Releases, GitHub Packages, and npm.\n\nThe repo keeps a base version line in `package.json`, and CI computes the next patch version at release time."
  );
}

function resolvePackageRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function normalizeRepositoryUrl(repository: RawPackageJson["repository"]): string | undefined {
  const raw =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object"
        ? repository.url
        : undefined;

  if (!raw) {
    return undefined;
  }

  return raw.replace(/^git\+/, "").replace(/\.git$/, "");
}
