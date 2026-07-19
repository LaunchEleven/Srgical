import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SkillRecord, SkillRegistrySnapshot, SkillScope, SkillTrust } from "@srgical/studio-shared";

export type SkillRegistryOptions = {
  homeDir?: string;
  repoId?: string;
  additionalDirectories?: Array<{
    path: string;
    scope?: SkillScope;
    providerId?: string;
    trust?: SkillTrust;
  }>;
};

export type SkillRegistryConfig = {
  version: 1;
  directories: string[];
  overrides: Record<string, { enabled?: boolean; trust?: SkillTrust }>;
};

type DiscoveryRoot = {
  path: string;
  scope: SkillScope;
  providerId?: string;
  trust: SkillTrust;
  precedence: number;
};

type ParsedFrontmatter = {
  attributes: Record<string, string>;
  body: string;
  warnings: string[];
};

export async function discoverSkills(
  workspace: string,
  options: SkillRegistryOptions = {}
): Promise<SkillRegistrySnapshot> {
  const homeDir = options.homeDir ?? os.homedir();
  const config = options.repoId ? await loadSkillRegistryConfig(options.repoId, homeDir) : emptyConfig();
  const globalSkillsDirectory = path.join(homeDir, ".srgical", "skills");
  await mkdir(globalSkillsDirectory, { recursive: true });
  const configuredDirectories: NonNullable<SkillRegistryOptions["additionalDirectories"]> = config.directories.map((directory) => ({
    path: directory
  }));

  const roots: DiscoveryRoot[] = dedupeRoots([
    { path: globalSkillsDirectory, scope: "global", trust: "trusted", precedence: 200 },
    { path: path.join(workspace, ".srgical", "skills"), scope: "project", trust: "trusted", precedence: 500 },
    { path: path.join(workspace, ".claude", "skills"), scope: "provider", providerId: "anthropic-agent-sdk", trust: "review", precedence: 420 },
    { path: path.join(workspace, ".codex", "skills"), scope: "provider", providerId: "codex", trust: "review", precedence: 410 },
    { path: path.join(workspace, ".agents", "skills"), scope: "project", trust: "review", precedence: 400 },
    { path: path.join(workspace, "skills"), scope: "project", trust: "review", precedence: 350 },
    { path: path.join(homeDir, ".claude", "skills"), scope: "provider", providerId: "anthropic-agent-sdk", trust: "review", precedence: 120 },
    { path: path.join(homeDir, ".codex", "skills"), scope: "provider", providerId: "codex", trust: "review", precedence: 110 },
    ...[
      ...configuredDirectories,
      ...(options.additionalDirectories ?? [])
    ].map((entry, index) => ({
      path: path.resolve(entry.path),
      scope: entry.scope ?? "provider",
      providerId: entry.providerId,
      trust: entry.trust ?? "review",
      precedence: 300 - index
    }))
  ]);

  const discovered = (await Promise.all(roots.map(async (root) => ({
    root,
    skills: await discoverRoot(root)
  })))).filter((entry) => entry.skills.length > 0 || path.resolve(entry.root.path) === path.resolve(globalSkillsDirectory));

  const candidates = discovered.flatMap((entry) => entry.skills.map((skill) => ({
    ...skill,
    precedence: entry.root.precedence
  })));
  const byId = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    byId.set(candidate.id, [...(byId.get(candidate.id) ?? []), candidate]);
  }

  const conflicts: SkillRegistrySnapshot["conflicts"] = [];
  const skills: SkillRecord[] = [];
  for (const [skillId, group] of byId) {
    group.sort((left, right) => right.precedence - left.precedence || left.source.localeCompare(right.source));
    const selected = group.find((item) => {
      const override = config.overrides[item.source];
      return (override?.enabled ?? item.enabled) && (override?.trust ?? item.trust) !== "blocked";
    }) ?? group[0];
    if (group.length > 1) {
      conflicts.push({
        skillId,
        sources: group.map((item) => item.source),
        selectedSource: selected.source
      });
    }
    for (const item of group) {
      const override = config.overrides[item.source];
      const enabled = override?.enabled ?? item.enabled;
      const trust = override?.trust ?? item.trust;
      const effective = item === selected && enabled && trust !== "blocked";
      skills.push({
        id: item.id,
        name: item.name,
        description: item.description,
        scope: item.scope,
        source: item.source,
        rootPath: item.rootPath,
        manifestPath: item.manifestPath,
        supportingFiles: item.supportingFiles,
        hash: item.hash,
        trust,
        enabled,
        effective,
        shadowedBy: item === selected ? null : selected.source,
        compatibleProviders: item.compatibleProviders,
        warnings: item.warnings
      });
    }
  }

  skills.sort((left, right) => Number(right.effective) - Number(left.effective) || left.name.localeCompare(right.name));
  return {
    globalSkillsDirectory,
    discoveredDirectories: discovered.map((entry) => entry.root.path),
    configuredDirectories: config.directories,
    skills,
    effectiveSkillHashes: skills.filter((skill) => skill.effective).map((skill) => skill.hash),
    conflicts
  };
}

export async function loadSkillRegistryConfig(repoId: string, homeDir = os.homedir()): Promise<SkillRegistryConfig> {
  try {
    const parsed = JSON.parse(await readFile(getSkillRegistryConfigPath(repoId, homeDir), "utf8")) as Partial<SkillRegistryConfig>;
    return {
      version: 1,
      directories: Array.isArray(parsed.directories) ? parsed.directories.filter((item): item is string => typeof item === "string") : [],
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {}
    };
  } catch {
    return emptyConfig();
  }
}

export async function setSkillOverride(
  repoId: string,
  source: string,
  update: { enabled?: boolean; trust?: SkillTrust },
  homeDir = os.homedir()
): Promise<void> {
  const config = await loadSkillRegistryConfig(repoId, homeDir);
  config.overrides[source] = { ...config.overrides[source], ...update };
  await saveConfig(repoId, config, homeDir);
}

export async function addSkillDirectory(repoId: string, directory: string, homeDir = os.homedir()): Promise<void> {
  const config = await loadSkillRegistryConfig(repoId, homeDir);
  const resolved = path.resolve(directory);
  config.directories = Array.from(new Set([...config.directories, resolved]));
  await saveConfig(repoId, config, homeDir);
}

export async function removeSkillDirectory(repoId: string, directory: string, homeDir = os.homedir()): Promise<void> {
  const config = await loadSkillRegistryConfig(repoId, homeDir);
  const key = path.resolve(directory).toLowerCase();
  config.directories = config.directories.filter((item) => path.resolve(item).toLowerCase() !== key);
  await saveConfig(repoId, config, homeDir);
}

export function getSkillRegistryConfigPath(repoId: string, homeDir = os.homedir()): string {
  return path.join(homeDir, ".srgical", "repos", repoId, "skills.json");
}

async function discoverRoot(root: DiscoveryRoot): Promise<Array<Omit<SkillRecord, "effective" | "shadowedBy">>> {
  let entries;
  try {
    entries = await readdir(root.path, { withFileTypes: true });
  } catch {
    return [];
  }

  const manifests: string[] = [];
  for (const entry of entries) {
    const candidate = entry.isDirectory()
      ? path.join(root.path, entry.name, "SKILL.md")
      : entry.isFile() && entry.name.toLowerCase() === "skill.md"
        ? path.join(root.path, entry.name)
        : null;
    if (candidate && await isRegularFile(candidate)) manifests.push(candidate);
  }

  return Promise.all(manifests.map(async (manifestPath) => {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = parseSkillFrontmatter(raw);
    const rootPath = path.dirname(manifestPath);
    const supportingFiles = await listSupportingFiles(rootPath);
    const hash = await hashSkill(rootPath, supportingFiles);
    const fallbackName = path.basename(rootPath) === path.basename(root.path)
      ? path.basename(root.path)
      : path.basename(rootPath);
    const name = parsed.attributes.name?.trim() || fallbackName;
    const id = sanitizeSkillId(parsed.attributes.id || name);
    const compatibleProviders = parseList(parsed.attributes.providers);
    if (root.providerId && !compatibleProviders.includes(root.providerId)) compatibleProviders.push(root.providerId);
    return {
      id,
      name,
      description: parsed.attributes.description?.trim() || firstBodyLine(parsed.body) || "No description provided.",
      scope: root.scope,
      source: root.providerId ? `${root.providerId}:${manifestPath}` : manifestPath,
      rootPath,
      manifestPath,
      supportingFiles,
      hash,
      trust: root.trust,
      enabled: parsed.attributes.enabled?.toLowerCase() !== "false",
      compatibleProviders,
      warnings: [...parsed.warnings, ...(id ? [] : ["Skill has no usable id."])]
    };
  }));
}

export function parseSkillFrontmatter(content: string): ParsedFrontmatter {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { attributes: {}, body: normalized, warnings: ["SKILL.md has no YAML frontmatter."] };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { attributes: {}, body: normalized, warnings: ["SKILL.md frontmatter is not closed."] };
  }
  const attributes: Record<string, string> = {};
  const warnings: string[] = [];
  for (const line of normalized.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) {
      warnings.push(`Unsupported frontmatter line: ${line.trim()}`);
      continue;
    }
    attributes[match[1].toLowerCase()] = stripQuotes(match[2].trim());
  }
  return { attributes, body: normalized.slice(end + 5), warnings };
}

async function listSupportingFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(rootPath, absolute).replace(/\\/g, "/"));
      }
    }
  };
  await visit(rootPath);
  return files.sort();
}

async function hashSkill(rootPath: string, files: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(rootPath, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    await realpath(filePath);
    return true;
  } catch {
    return false;
  }
}

function dedupeRoots(roots: DiscoveryRoot[]): DiscoveryRoot[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = path.resolve(root.path).replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeSkillId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.replace(/^\[|\]$/g, "").split(",").map((item) => stripQuotes(item.trim())).filter(Boolean);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function firstBodyLine(body: string): string {
  return body.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
}

function emptyConfig(): SkillRegistryConfig {
  return { version: 1, directories: [], overrides: {} };
}

async function saveConfig(repoId: string, config: SkillRegistryConfig, homeDir: string): Promise<void> {
  const filePath = getSkillRegistryConfigPath(repoId, homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
}
