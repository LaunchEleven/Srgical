import { readdir } from "node:fs/promises";
import path from "node:path";
import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type ReferenceCatalogEntry = {
  id: string;
  title: string;
  summary: string;
  path: string;
  tags: string[];
  selected: boolean;
};

export type ReferenceRecommendation = {
  id: string;
  score: number;
  reason: string;
};

export type SelectedReferenceDocument = {
  id: string;
  title: string;
  path: string;
  summary: string;
  tags: string[];
  contentSnippet: string;
};

export type ReferenceDirectoryOption = {
  path: string;
  name: string;
};

type StoredReferenceSelections = {
  version: 1;
  updatedAt: string;
  selectedIds: string[];
};

type StoredReferenceRoots = {
  version: 1;
  updatedAt: string;
  roots: string[];
};

const MAX_REFERENCE_FILES = 40;
const REFERENCE_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const REFERENCE_ROOT_CANDIDATES = ["README.md", "docs", "REFERENCE"];
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".srgical", ".artifacts", "coverage"]);

export async function loadReferenceCatalog(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<ReferenceCatalogEntry[]> {
  const selectedIds = new Set(await loadSelectedReferenceIds(workspaceRoot, options));
  const candidates = await collectReferenceFiles(workspaceRoot, options);

  return candidates.map((candidate) => ({
    ...candidate,
    selected: selectedIds.has(candidate.id)
  }));
}

export async function toggleReferenceSelection(
  workspaceRoot: string,
  referenceId: string,
  selected: boolean,
  options: PlanningPathOptions = {}
): Promise<string[]> {
  const current = new Set(await loadSelectedReferenceIds(workspaceRoot, options));
  if (selected) {
    current.add(referenceId);
  } else {
    current.delete(referenceId);
  }
  await saveSelectedReferenceIds(workspaceRoot, Array.from(current), options);
  return Array.from(current).sort((left, right) => left.localeCompare(right));
}

export async function loadSelectedReferenceIds(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<string[]> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  if (!(await fileExists(paths.referenceSelections))) {
    return [];
  }

  try {
    const parsed = JSON.parse(await readText(paths.referenceSelections)) as Partial<StoredReferenceSelections>;
    return Array.isArray(parsed.selectedIds)
      ? parsed.selectedIds.filter((value): value is string => typeof value === "string").sort((left, right) => left.localeCompare(right))
      : [];
  } catch {
    return [];
  }
}

export async function saveSelectedReferenceIds(
  workspaceRoot: string,
  selectedIds: string[],
  options: PlanningPathOptions = {}
): Promise<void> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const normalized = Array.from(new Set(selectedIds.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  await writeText(
    paths.referenceSelections,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        selectedIds: normalized
      } satisfies StoredReferenceSelections,
      null,
      2
    )
  );
}

export async function loadReferenceRoots(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<string[]> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  if (!(await fileExists(paths.referenceRoots))) {
    return [];
  }

  try {
    const parsed = JSON.parse(await readText(paths.referenceRoots)) as Partial<StoredReferenceRoots>;
    return sanitizeReferenceRoots(Array.isArray(parsed.roots) ? parsed.roots : []);
  } catch {
    return [];
  }
}

export async function saveReferenceRoots(
  workspaceRoot: string,
  roots: string[],
  options: PlanningPathOptions = {}
): Promise<string[]> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const normalized = sanitizeReferenceRoots(roots);
  await writeText(
    paths.referenceRoots,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        roots: normalized
      } satisfies StoredReferenceRoots,
      null,
      2
    )
  );
  return normalized;
}

export async function addReferenceRoot(
  workspaceRoot: string,
  root: string,
  options: PlanningPathOptions = {}
): Promise<string[]> {
  const current = await loadReferenceRoots(workspaceRoot, options);
  return saveReferenceRoots(workspaceRoot, [...current, root], options);
}

export async function removeReferenceRoot(
  workspaceRoot: string,
  root: string,
  options: PlanningPathOptions = {}
): Promise<string[]> {
  const current = await loadReferenceRoots(workspaceRoot, options);
  return saveReferenceRoots(
    workspaceRoot,
    current.filter((entry) => entry.toLowerCase() !== root.trim().toLowerCase()),
    options
  );
}

export async function loadSelectedReferenceDocuments(
  workspaceRoot: string,
  options: PlanningPathOptions = {},
  maxChars = 5000
): Promise<SelectedReferenceDocument[]> {
  const catalog = await loadReferenceCatalog(workspaceRoot, options);
  const selected = catalog.filter((entry) => entry.selected);

  return Promise.all(
    selected.map(async (entry) => ({
      id: entry.id,
      title: entry.title,
      path: entry.path,
      summary: entry.summary,
      tags: entry.tags,
      contentSnippet: limitText(await readText(path.join(workspaceRoot, entry.path)).catch(() => ""), maxChars)
    }))
  );
}

export async function listReferenceDirectoryOptions(
  workspaceRoot: string,
  relativePath = ""
): Promise<{
  currentPath: string;
  parentPath: string | null;
  directories: ReferenceDirectoryOption[];
}> {
  const normalizedPath = normalizeRootInput(relativePath);
  const absolutePath = normalizedPath ? path.join(workspaceRoot, normalizedPath) : workspaceRoot;
  const directories = await readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  const visibleDirectories = directories
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
    .map((entry) => {
      const relativeEntryPath = [normalizedPath, entry.name].filter(Boolean).join("/").replace(/\\/g, "/");
      return {
        path: relativeEntryPath,
        name: entry.name
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    currentPath: normalizedPath,
    parentPath: normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : normalizedPath ? "" : null,
    directories: visibleDirectories
  };
}

export function recommendReferences(
  catalog: Array<Pick<ReferenceCatalogEntry, "id" | "title" | "summary" | "path" | "tags">>,
  options: {
    planId?: string | null;
    evidence?: string[];
    unknowns?: string[];
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    limit?: number;
  } = {}
): ReferenceRecommendation[] {
  const weightedTerms = buildWeightedTerms(options);

  return catalog
    .map((entry) => {
      const haystack = [
        entry.title,
        entry.summary,
        entry.path,
        entry.tags.join(" ")
      ].join(" ").toLowerCase();
      let score = 0;
      const reasons = new Set<string>();

      for (const [term, weight] of weightedTerms) {
        if (!term || term.length < 3) {
          continue;
        }
        if (haystack.includes(term)) {
          score += weight;
          reasons.add(term);
        }
      }

      for (const tag of entry.tags) {
        const tagWeight = weightedTerms.get(tag);
        if (tagWeight) {
          score += tagWeight + 1;
          reasons.add(tag);
        }
      }

      return {
        id: entry.id,
        score,
        reason: reasons.size > 0
          ? `Matches ${Array.from(reasons).slice(0, 3).join(", ")}.`
          : "General guidance."
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, options.limit ?? 6);
}

async function collectReferenceFiles(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<Omit<ReferenceCatalogEntry, "selected">[]> {
  const collected: Array<Omit<ReferenceCatalogEntry, "selected">> = [];
  const configuredRoots = await loadReferenceRoots(workspaceRoot, options);
  const rootCandidates = [...REFERENCE_ROOT_CANDIDATES, ...configuredRoots];
  const seenRoots = new Set<string>();

  for (const candidate of rootCandidates) {
    if (collected.length >= MAX_REFERENCE_FILES) {
      break;
    }

    const normalizedCandidate = candidate.replace(/\\/g, "/").trim();
    const dedupeKey = normalizedCandidate.toLowerCase();
    if (!normalizedCandidate || seenRoots.has(dedupeKey)) {
      continue;
    }
    seenRoots.add(dedupeKey);

    const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.join(workspaceRoot, candidate);
    if (!(await fileExists(absolute))) {
      continue;
    }

    const stats = await readdirOrNull(absolute);
    if (stats) {
      await walkReferenceDirectory(absolute, workspaceRoot, collected);
      continue;
    }

    const entry = await buildReferenceEntry(absolute, workspaceRoot);
    if (entry) {
      collected.push(entry);
    }
  }

  return collected.slice(0, MAX_REFERENCE_FILES);
}

async function walkReferenceDirectory(
  directoryPath: string,
  workspaceRoot: string,
  collected: Array<Omit<ReferenceCatalogEntry, "selected">>
): Promise<void> {
  if (collected.length >= MAX_REFERENCE_FILES) {
    return;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (collected.length >= MAX_REFERENCE_FILES) {
      return;
    }
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walkReferenceDirectory(fullPath, workspaceRoot, collected);
      continue;
    }
    if (!REFERENCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    const built = await buildReferenceEntry(fullPath, workspaceRoot);
    if (built) {
      collected.push(built);
    }
  }
}

async function buildReferenceEntry(
  filePath: string,
  workspaceRoot: string
): Promise<Omit<ReferenceCatalogEntry, "selected"> | null> {
  const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
  const raw = await readText(filePath).catch(() => "");
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const title =
    lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim() ||
    path.basename(filePath, path.extname(filePath)).replace(/[-_]/g, " ");
  const summarySource = lines.find((line) => line.length > 0 && !/^#/.test(line)) ?? "";
  const summary = summarySource.length > 180 ? `${summarySource.slice(0, 177).trimEnd()}...` : summarySource || "Reference guidance document.";
  const tags = deriveReferenceTags(relativePath, raw);

  return {
    id: relativePath.toLowerCase(),
    title,
    summary,
    path: relativePath,
    tags
  };
}

function deriveReferenceTags(relativePath: string, raw: string): string[] {
  const normalizedPath = relativePath.toLowerCase();
  const haystack = `${normalizedPath}\n${raw.toLowerCase()}`;
  const tags = new Set<string>();

  if (/test|vitest|jest|playwright|coverage/.test(haystack)) {
    tags.add("testing");
  }
  if (/architect|structure|design|adr|boundary|seam/.test(haystack)) {
    tags.add("architecture");
  }
  if (/prompt|agent|skill|ai|codex|claude|augment/.test(haystack)) {
    tags.add("ai");
  }
  if (/security|auth|permission|credential/.test(haystack)) {
    tags.add("security");
  }
  if (/release|pr|pull request|deploy|rollout/.test(haystack)) {
    tags.add("delivery");
  }
  if (tags.size === 0) {
    tags.add("general");
  }

  return Array.from(tags);
}

function buildWeightedTerms(options: {
  planId?: string | null;
  evidence?: string[];
  unknowns?: string[];
  messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}): Map<string, number> {
  const terms = new Map<string, number>();
  const addTokens = (source: string | null | undefined, weight: number) => {
    for (const token of tokenize(source ?? "")) {
      terms.set(token, Math.max(weight, terms.get(token) ?? 0));
    }
  };

  addTokens(options.planId, 5);
  for (const evidence of options.evidence ?? []) {
    addTokens(evidence, 4);
  }
  for (const unknown of options.unknowns ?? []) {
    addTokens(unknown, 3);
  }
  for (const message of options.messages ?? []) {
    if (message.role === "user") {
      addTokens(message.content, 2);
    }
  }

  return terms;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function sanitizeReferenceRoots(roots: string[]): string[] {
  return Array.from(
    new Set(
      roots
        .map((value) => normalizeRootInput(value))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeRootInput(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "build",
  "change",
  "changes",
  "clear",
  "current",
  "from",
  "have",
  "into",
  "just",
  "make",
  "need",
  "next",
  "none",
  "plan",
  "repo",
  "should",
  "still",
  "that",
  "the",
  "then",
  "they",
  "this",
  "true",
  "use",
  "user",
  "with",
  "work"
]);

async function readdirOrNull(targetPath: string): Promise<unknown[] | null> {
  try {
    return await readdir(targetPath);
  } catch {
    return null;
  }
}

function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value.trim();
  }

  return `${value.slice(0, maxChars).trimEnd()}\n... [truncated after ${maxChars} chars]`;
}
