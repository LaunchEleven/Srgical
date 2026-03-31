import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

const REFERENCE_DOC_CHAR_LIMIT = 4000;
const REFERENCE_DOC_COUNT_LIMIT = 10;
const REFERENCE_FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".prompt", ".adoc", ".rst", ".yaml", ".yml", ".json"]);

type StoredStudioOperateConfig = {
  version: 1;
  updatedAt: string;
  pauseForPr: boolean;
  referencePaths: string[];
};

export type StudioOperateConfig = {
  pauseForPr: boolean;
  referencePaths: string[];
  updatedAt: string;
};

export type StudioOperateGuidanceDoc = {
  displayPath: string;
  content: string;
  truncated: boolean;
};

export type StudioOperateGuidanceSnapshot = {
  config: StudioOperateConfig;
  docs: StudioOperateGuidanceDoc[];
  warnings: string[];
};

const DEFAULT_CONFIG: StudioOperateConfig = {
  pauseForPr: false,
  referencePaths: [],
  updatedAt: "1970-01-01T00:00:00.000Z"
};

export async function loadStudioOperateConfig(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<StudioOperateConfig> {
  const paths = getPlanningPackPaths(workspaceRoot, options);

  if (!(await fileExists(paths.studioOperateConfig))) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  try {
    const raw = await readText(paths.studioOperateConfig);
    const parsed = JSON.parse(raw) as Partial<StoredStudioOperateConfig>;
    return {
      pauseForPr: Boolean(parsed.pauseForPr),
      referencePaths: sanitizeReferencePaths(Array.isArray(parsed.referencePaths) ? parsed.referencePaths : []),
      updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0 ? parsed.updatedAt : DEFAULT_CONFIG.updatedAt
    };
  } catch {
    return cloneConfig(DEFAULT_CONFIG);
  }
}

export async function saveStudioOperateConfig(
  workspaceRoot: string,
  updates: {
    pauseForPr?: boolean;
    referencePaths?: string[];
  },
  options: PlanningPathOptions = {}
): Promise<StudioOperateConfig> {
  const current = await loadStudioOperateConfig(workspaceRoot, options);
  const next: StoredStudioOperateConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pauseForPr: updates.pauseForPr ?? current.pauseForPr,
    referencePaths: sanitizeReferencePaths(updates.referencePaths ?? current.referencePaths)
  };

  const paths = await ensurePlanningDir(workspaceRoot, options);
  await writeText(paths.studioOperateConfig, JSON.stringify(next, null, 2));

  return {
    pauseForPr: next.pauseForPr,
    referencePaths: next.referencePaths,
    updatedAt: next.updatedAt
  };
}

export function sanitizeReferencePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const cleaned = trimmed.replace(/\\/g, "/");
    const dedupeKey = cleaned.toLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push(cleaned);
  }

  return normalized;
}

export async function loadStudioOperateGuidanceSnapshot(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<StudioOperateGuidanceSnapshot> {
  const config = await loadStudioOperateConfig(workspaceRoot, options);
  return loadGuidanceSnapshotForConfig(workspaceRoot, config);
}

export async function buildStudioOperateGuidancePromptSection(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<string | null> {
  const snapshot = await loadStudioOperateGuidanceSnapshot(workspaceRoot, options);

  if (snapshot.docs.length === 0 && snapshot.warnings.length === 0) {
    return null;
  }

  const lines: string[] = [
    "Operate guidance references (loaded from `srgical studio config` for this plan):",
    "- Treat these as secondary guard rails after the canonical handoff and tracker updates.",
    "- Use them to keep implementation and PR messaging aligned with local standards.",
    ""
  ];

  if (snapshot.docs.length > 0) {
    for (const doc of snapshot.docs) {
      lines.push(`Reference: \`${doc.displayPath}\`${doc.truncated ? " (truncated)" : ""}`);
      lines.push(doc.content);
      lines.push("");
    }
  }

  if (snapshot.warnings.length > 0) {
    lines.push("Reference loading warnings:");
    lines.push(...snapshot.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n").trimEnd();
}

async function loadGuidanceSnapshotForConfig(
  workspaceRoot: string,
  config: StudioOperateConfig
): Promise<StudioOperateGuidanceSnapshot> {
  const docs: StudioOperateGuidanceDoc[] = [];
  const warnings: string[] = [];
  const seenFiles = new Set<string>();

  for (const configuredPath of config.referencePaths) {
    if (docs.length >= REFERENCE_DOC_COUNT_LIMIT) {
      warnings.push(`Hit guidance limit (${REFERENCE_DOC_COUNT_LIMIT} files). Additional paths were skipped.`);
      break;
    }

    const resolvedPath = resolveReferencePath(workspaceRoot, configuredPath);

    if (!(await fileExists(resolvedPath))) {
      warnings.push(`Missing reference path: ${configuredPath}`);
      continue;
    }

    const details = await stat(resolvedPath);
    const remaining = REFERENCE_DOC_COUNT_LIMIT - docs.length;
    const files = details.isDirectory()
      ? await collectReferenceFilesFromDirectory(resolvedPath, remaining)
      : details.isFile()
        ? [resolvedPath]
        : [];

    if (files.length === 0) {
      warnings.push(`No readable guidance files found under: ${configuredPath}`);
      continue;
    }

    for (const filePath of files) {
      const normalizedFile = filePath.toLowerCase();

      if (seenFiles.has(normalizedFile)) {
        continue;
      }

      seenFiles.add(normalizedFile);

      try {
        const raw = await readText(filePath);
        const normalized = raw.replace(/\r\n/g, "\n");
        const truncated = normalized.length > REFERENCE_DOC_CHAR_LIMIT;
        const content = truncated
          ? `${normalized.slice(0, REFERENCE_DOC_CHAR_LIMIT).trimEnd()}\n... [truncated after ${REFERENCE_DOC_CHAR_LIMIT} chars]`
          : normalized;

        docs.push({
          displayPath: toDisplayPath(workspaceRoot, filePath),
          content,
          truncated
        });
      } catch {
        warnings.push(`Unable to read configured reference file: ${toDisplayPath(workspaceRoot, filePath)}`);
      }

      if (docs.length >= REFERENCE_DOC_COUNT_LIMIT) {
        break;
      }
    }
  }

  return {
    config,
    docs,
    warnings
  };
}

async function collectReferenceFilesFromDirectory(directoryPath: string, limit: number): Promise<string[]> {
  if (limit <= 0) {
    return [];
  }

  const queue = [directoryPath];
  const files: string[] = [];

  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= limit) {
        break;
      }

      const candidatePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(candidatePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!shouldIncludeReferenceFile(candidatePath)) {
        continue;
      }

      files.push(candidatePath);
    }
  }

  return files;
}

function shouldIncludeReferenceFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();

  if (REFERENCE_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  return path.basename(filePath).toLowerCase().includes("prompt") || path.basename(filePath).toLowerCase().includes("guideline");
}

function resolveReferencePath(workspaceRoot: string, configuredPath: string): string {
  const trimmed = configuredPath.trim();
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(workspaceRoot, trimmed);
}

function toDisplayPath(workspaceRoot: string, absolutePath: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  return relative.startsWith("..") ? absolutePath.replace(/\\/g, "/") : relative.replace(/\\/g, "/");
}

function cloneConfig(config: StudioOperateConfig): StudioOperateConfig {
  return {
    pauseForPr: config.pauseForPr,
    referencePaths: [...config.referencePaths],
    updatedAt: config.updatedAt
  };
}
