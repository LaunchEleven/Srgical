import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileExists, getPlanningPackPaths, readText } from "./workspace";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const REPO_FILE_LIST_LIMIT = 24;
const FILE_SNIPPET_LIMIT = 2200;

function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message, index) => {
      const label = message.role === "user" ? "User" : message.role === "assistant" ? "Planner" : "System";
      return `${index + 1}. ${label}: ${message.content}`;
    })
    .join("\n\n");
}

export function buildPlannerPrompt(messages: ChatMessage[], workspaceRoot: string): string {
  return `You are the planning partner inside srgical, a local-first CLI that helps users turn long AI-driven delivery
projects into a disciplined execution pack.

Your job in this mode is conversation only. Do not write files. Do not output markdown boilerplate. Help the user
clarify the project and get it ready for pack generation.

Rules:
- Be concise, sharp, and practical.
- Ask at most one clarifying question at a time.
- Prefer decisions over brainstorming sprawl.
- Optimize for shipping a concrete first version.
- The current workspace is: ${workspaceRoot}

Conversation so far:

${renderTranscript(messages)}

Respond as the planning partner.`;
}

export async function buildPackWriterPrompt(messages: ChatMessage[], workspaceRoot: string): Promise<string> {
  const repoTruth = await buildRepoTruthSnapshot(workspaceRoot);

  return `You are writing a planning pack for the current repository.

Read the conversation transcript below and update or create the following files under .srgical/:

- 01-product-plan.md
- 02-agent-context-kickoff.md
- 03-detailed-implementation-plan.md
- 04-next-agent-prompt.md

Operating rules:
- Start from the repo truth snapshot below, not from generic assumptions.
- Treat any existing .srgical files as current project state to refine in place, not blank templates to overwrite casually.
- Preserve valid locked decisions, completed steps, and step IDs unless the repo truth or conversation clearly requires a change.
- Prefer repo truth for what already exists in the codebase and the conversation for what the user now wants next.
- Make the pack specific to the actual commands, docs, stack, and current capabilities in this workspace.
- Do not invent frameworks, release channels, adapters, tests, or subsystems that are not supported by the repo truth or transcript.
- Keep the workflow local-first, explicit, incremental, and validation-aware.

Quality bar:
- 01-product-plan.md should capture the real product direction, locked decisions, and current repo findings.
- 02-agent-context-kickoff.md should capture current repo truth, working agreements, current position, and a concise handoff log.
- 03-detailed-implementation-plan.md should keep a readable status legend, current position, phase-based next steps, and concrete notes.
- 04-next-agent-prompt.md should enforce incremental execution, validation, tracker updates, and stop conditions.
- The tracker should stay execution-ready: use concrete step IDs, realistic acceptance criteria, and concise validation notes instead of filler.

Repo truth snapshot:

${repoTruth}

Conversation transcript:

${renderTranscript(messages)}
`;
}

async function buildRepoTruthSnapshot(workspaceRoot: string): Promise<string> {
  const paths = getPlanningPackPaths(workspaceRoot);
  const [
    packageSummary,
    topLevelEntries,
    sourceFiles,
    docFiles,
    readmeSnippet,
    foundationSnippet,
    adrSnippet,
    planSnippet,
    contextSnippet,
    trackerSnippet,
    nextPromptSnippet
  ] = await Promise.all([
    summarizePackageManifest(workspaceRoot),
    listDirectoryEntries(workspaceRoot),
    listRelativeFiles(path.join(workspaceRoot, "src"), workspaceRoot, REPO_FILE_LIST_LIMIT),
    listRelativeFiles(path.join(workspaceRoot, "docs"), workspaceRoot, REPO_FILE_LIST_LIMIT),
    readSnippet(workspaceRoot, "README.md", FILE_SNIPPET_LIMIT),
    readSnippet(workspaceRoot, "docs/product-foundation.md", FILE_SNIPPET_LIMIT),
    readSnippet(workspaceRoot, "docs/adr/0001-tech-stack.md", FILE_SNIPPET_LIMIT),
    readOptionalAbsoluteSnippet(paths.plan, workspaceRoot, FILE_SNIPPET_LIMIT),
    readOptionalAbsoluteSnippet(paths.context, workspaceRoot, FILE_SNIPPET_LIMIT),
    readOptionalAbsoluteSnippet(paths.tracker, workspaceRoot, FILE_SNIPPET_LIMIT),
    readOptionalAbsoluteSnippet(paths.nextPrompt, workspaceRoot, FILE_SNIPPET_LIMIT)
  ]);

  return [
    `Workspace root: ${workspaceRoot}`,
    "",
    "Top-level repo entries:",
    renderList(topLevelEntries),
    "",
    "Source file inventory:",
    renderList(sourceFiles),
    "",
    "Docs file inventory:",
    renderList(docFiles),
    "",
    "Package manifest:",
    packageSummary,
    "",
    "Key docs:",
    renderNamedSnippet("README.md", readmeSnippet),
    "",
    renderNamedSnippet("docs/product-foundation.md", foundationSnippet),
    "",
    renderNamedSnippet("docs/adr/0001-tech-stack.md", adrSnippet),
    "",
    "Existing planning-pack files:",
    renderNamedSnippet(".srgical/01-product-plan.md", planSnippet),
    "",
    renderNamedSnippet(".srgical/02-agent-context-kickoff.md", contextSnippet),
    "",
    renderNamedSnippet(".srgical/03-detailed-implementation-plan.md", trackerSnippet),
    "",
    renderNamedSnippet(".srgical/04-next-agent-prompt.md", nextPromptSnippet)
  ].join("\n");
}

async function summarizePackageManifest(workspaceRoot: string): Promise<string> {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const exists = await fileExists(packageJsonPath);

  if (!exists) {
    return "- package.json not present";
  }

  try {
    const raw = await readText(packageJsonPath);
    const parsed = JSON.parse(raw) as {
      name?: string;
      version?: string;
      description?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const scripts = Object.entries(parsed.scripts ?? {}).map(([name, command]) => `${name}: ${command}`);
    const dependencies = Object.entries(parsed.dependencies ?? {}).map(([name, version]) => `${name}: ${version}`);
    const devDependencies = Object.entries(parsed.devDependencies ?? {}).map(([name, version]) => `${name}: ${version}`);

    return [
      `- name: ${parsed.name ?? "unknown"}`,
      `- version: ${parsed.version ?? "unknown"}`,
      `- description: ${parsed.description ?? "none"}`,
      "- scripts:",
      renderList(scripts),
      "- dependencies:",
      renderList(dependencies),
      "- devDependencies:",
      renderList(devDependencies)
    ].join("\n");
  } catch {
    const fallback = await readText(packageJsonPath);
    return limitText(fallback.trim(), FILE_SNIPPET_LIMIT);
  }
}

async function listDirectoryEntries(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return ["- unavailable"];
  }
}

async function listRelativeFiles(directoryPath: string, workspaceRoot: string, maxCount: number): Promise<string[]> {
  const collected: string[] = [];
  const exists = await fileExists(directoryPath);

  if (!exists) {
    return ["- unavailable"];
  }

  await walkFiles(directoryPath, workspaceRoot, collected, maxCount);

  if (collected.length === 0) {
    return ["- none"];
  }

  return collected;
}

async function walkFiles(
  directoryPath: string,
  workspaceRoot: string,
  collected: string[],
  maxCount: number
): Promise<void> {
  if (collected.length >= maxCount || hasTruncationMarker(collected)) {
    return;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (collected.length >= maxCount) {
      collected.push(`... truncated after ${maxCount} files`);
      return;
    }

    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkFiles(fullPath, workspaceRoot, collected, maxCount);
      continue;
    }

    collected.push(path.relative(workspaceRoot, fullPath).replace(/\\/g, "/"));
  }
}

async function readSnippet(workspaceRoot: string, relativePath: string, maxChars: number): Promise<string> {
  return readOptionalAbsoluteSnippet(path.join(workspaceRoot, relativePath), workspaceRoot, maxChars);
}

async function readOptionalAbsoluteSnippet(filePath: string, workspaceRoot: string, maxChars: number): Promise<string> {
  const exists = await fileExists(filePath);

  if (!exists) {
    return "- missing";
  }

  try {
    const content = await readText(filePath);
    const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
    return [`Path: ${relativePath}`, limitText(content.trim(), maxChars)].join("\n");
  } catch {
    return "- unreadable";
  }
}

function renderNamedSnippet(name: string, content: string): string {
  return [`${name}:`, content].join("\n");
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map((item) => (item.startsWith("- ") ? item : `- ${item}`)).join("\n");
}

function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  // Keep snippets short enough to ground the planner without overwhelming the prompt.
  return `${value.slice(0, maxChars).trimEnd()}\n... [truncated after ${maxChars} chars]`;
}

function hasTruncationMarker(items: string[]): boolean {
  return items.some((item) => item.startsWith("... truncated after "));
}
