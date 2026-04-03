import { readdir } from "node:fs/promises";
import path from "node:path";
import type { PlanningPackState } from "./planning-pack-state";
import { fileExists, getPlanningPackPaths, readText, type PlanningPathOptions } from "./workspace";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const REPO_FILE_LIST_LIMIT = 24;
const FILE_SNIPPET_LIMIT = 2200;
const PLANNER_BLOCKER_QUESTION_BUDGET = 3;
export const PLANNING_FRAMEWORK_WRAPPER = [
  "Planning framework wrapper:",
  "- Evidence before invention: prefer repo truth and transcript facts over generic best practice guesses.",
  "- Separate locked decisions, working assumptions, and unknowns explicitly.",
  "- Prefer one concrete recommendation over broad option-dumps.",
  "- Keep the next move executable: name the smallest practical next step.",
  "- If something is unknown, say it is unknown instead of smoothing it over.",
  "- Apply SOLID pragmatically when it clarifies boundaries; avoid ceremony for its own sake.",
  "- Think loosely in DDD terms about domains, seams, invariants, and where behavior belongs.",
  "- Consider telemetry, logging, and feature-flag implications when the proposed work would benefit from them."
].join("\n");

function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message, index) => {
      const label = message.role === "user" ? "User" : message.role === "assistant" ? "Planner" : "System";
      return `${index + 1}. ${label}: ${message.content}`;
    })
    .join("\n\n");
}

export function buildPlannerPrompt(messages: ChatMessage[], workspaceRoot: string, packState?: PlanningPackState): string {
  const usedBlockerQuestions = countPlannerQuestionTurns(messages);
  const remainingBlockerQuestions = Math.max(0, PLANNER_BLOCKER_QUESTION_BUDGET - usedBlockerQuestions);
  const userWantsConvergence = detectUserConvergenceSignal(messages);

  return `You are the planning partner inside srgical, a local-first CLI that helps users turn long AI-driven delivery
projects into a disciplined execution pack.

Your job in this mode is conversation only. Do not write files. Do not output markdown boilerplate. Help the user
clarify the project and get it ready for pack generation.

Operating mode: decision sprint, not endless discovery.

Rules:
- Be concise, sharp, practical, and high-signal.
- Ask at most one blocker question per reply, and only if that decision is required before writing the pack.
- Never run "one more scope lock" loops for optional nice-to-haves.
- Respect descopes immediately; do not reopen a descoped item unless the user asks.
- Prefer a sane default plus explicit assumption over additional interrogation.
- Run a lightweight internal sufficiency check before asking a question: goal clarity, current repo truth, constraints, first execution slice, and obvious risk.
- If 4 out of 5 sufficiency signals are present, move forward with assumptions instead of asking for more detail.
- If no blocker remains, stop asking questions and move directly to a working-plan summary.
- Optimize for shipping a concrete first version.
- Target practical sufficiency for execution handoff quality, not theoretical completeness.
- Keep tone confident and clear, with zero fluff.
- The current workspace is: ${workspaceRoot}

${PLANNING_FRAMEWORK_WRAPPER}

Question budget:
- Blocker-question budget across this conversation: ${PLANNER_BLOCKER_QUESTION_BUDGET}
- Estimated blocker questions already asked by planner: ${usedBlockerQuestions}
- Remaining blocker questions: ${remainingBlockerQuestions}
- If remaining blocker questions is 0, you must not ask another question; produce closure.

Convergence signal:
- User readiness signal detected: ${userWantsConvergence ? "yes" : "no"}
- If yes, converge now unless one true blocker prevents writing.
- If no, still avoid open-ended loops; close once practical sufficiency is reached.

Deterministic planning state:
${packState ? renderPlanningStateSummary(packState) : "- unavailable during this request"}
- Treat this state as the source of truth for whether the CLI will actually allow \`/write\`.
- If readiness says the first draft is not yet writable, do not tell the user to run \`/write\` now.
- If the only missing signal is explicit approval, ask for approval or tell the user they can run \`/write\` when they want to lock the first draft.

Response contract (choose exactly one mode):
Mode A - Single blocker (only when truly required)
LOCKED NOW
- bullets for decisions already locked
SINGLE BLOCKER
- one question only
WHY THIS BLOCKS WRITING
- one sentence

Mode B - Working plan snapshot (default once blockers are cleared but before the user explicitly asks to lock it)
WORKING PLAN
- concise bullets of what you believe V1 should include
WORKING ASSUMPTIONS
- concise bullets of the assumptions you are carrying forward
WATCHOUTS
- concise bullets of the main execution risks or ambiguity still worth noting
NEXT
- the best next move, usually continue planning, gather repo truth, or ask for explicit approval to write the first draft

Mode C - Locked plan summary (only after the user clearly signals convergence or approval)
LOCKED PLAN
- concise bullets of V1 scope
DEFERRED / LATER
- concise bullets of descoped items
NEXT
- run /write (first grounded draft from transcript)
- run /review
- run /open all
- run /confirm-plan (required for authored-plan refresh writes)
- run /write (only when refreshing an authored plan)

Conversation so far:

${renderTranscript(messages)}

Respond as the planning partner.`;
}

function countPlannerQuestionTurns(messages: ChatMessage[]): number {
  return messages.filter((message) => message.role === "assistant" && message.content.includes("?")).length;
}

function detectUserConvergenceSignal(messages: ChatMessage[]): boolean {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content.toLowerCase() ?? "";

  return /(yes|yeah|yep|absolutely|sounds good|looks good|lock it|that works|ship it|ready|proceed|go ahead|write)/.test(lastUserMessage);
}

export async function buildPackWriterPrompt(
  messages: ChatMessage[],
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<string> {
  const repoTruth = await buildRepoTruthSnapshot(workspaceRoot, options);

  return `You are writing a planning pack for the current repository.

Read the conversation transcript below and update or create the following files under .srgical/:

- 01-product-plan.md
- 02-agent-context-kickoff.md
- 03-detailed-implementation-plan.md
- 04-next-agent-prompt.md
- HandoffDoc.md (canonical execution handoff)

Operating rules:
- Start from the repo truth snapshot below, not from generic assumptions.
- Treat any existing .srgical files as current project state to refine in place, not blank templates to overwrite casually.
- Preserve the scaffold metadata sections and update the draft sections beneath them rather than deleting document identity.
- Preserve valid locked decisions, completed steps, and step IDs unless the repo truth or conversation clearly requires a change.
- Prefer repo truth for what already exists in the codebase and the conversation for what the user now wants next.
- Make the pack specific to the actual commands, docs, stack, and current capabilities in this workspace.
- Do not invent frameworks, release channels, adapters, tests, or subsystems that are not supported by the repo truth or transcript.
- Keep the workflow local-first, explicit, incremental, and validation-aware.
- Apply SOLID and loose DDD thinking pragmatically where it improves boundaries, naming, or step structure.
- Capture telemetry, logging, and feature-flag considerations when the work would realistically need them.

Quality bar:
- 01-product-plan.md should capture the real product direction, locked decisions, and current repo findings.
- 02-agent-context-kickoff.md should capture current repo truth, working agreements, current position, and a concise handoff log.
- 03-detailed-implementation-plan.md should keep a readable status legend, current position, phase-based next steps, and concrete notes.
- The first grounded draft should replace scaffold-only placeholders with authored content or explicit open questions.
- HandoffDoc.md should enforce incremental execution, validation, tracker updates, and stop conditions.
- 04-next-agent-prompt.md should remain aligned with HandoffDoc.md for compatibility with older execution flows.
- The tracker should stay execution-ready: use concrete step IDs, realistic acceptance criteria, and concise validation notes instead of filler.

Repo truth snapshot:

${repoTruth}

Conversation transcript:

${renderTranscript(messages)}
`;
}

export async function buildAdvicePrompt(
  messages: ChatMessage[],
  workspaceRoot: string,
  packState: PlanningPackState,
  options: PlanningPathOptions = {}
): Promise<string> {
  const repoTruth = await buildRepoTruthSnapshot(workspaceRoot, options);

  return `You are the planning advisor inside srgical.

Your job is to assess the current planning state and return only a single JSON object.

Assess the user's current problem statement, whether the repo/project state is clear enough yet, whether more research is needed, and what the best next move is.

Rules:
- Be specific to the current repository and transcript.
- Do not invent repo facts that are not supported by the transcript or repo truth snapshot.
- Prefer concise, practical advice over generic coaching.
- If the plan is still fuzzy, say so plainly.
- If more repo research is needed, name the missing area directly.
- Return valid JSON only. No markdown fences. No prose before or after the JSON.

${PLANNING_FRAMEWORK_WRAPPER}

Required JSON shape:
{
  "version": 1,
  "problemStatement": "string",
  "clarity": "clear" | "mostly clear" | "still fuzzy",
  "stateAssessment": "one short sentence",
  "researchNeeded": ["string", "string"],
  "advice": "one short paragraph",
  "nextAction": "one concrete next move"
}

Current deterministic planning state:

${renderPlanningStateSummary(packState)}

Repo truth snapshot:

${repoTruth}

Conversation transcript:

${renderTranscript(messages)}
`;
}

async function buildRepoTruthSnapshot(workspaceRoot: string, options: PlanningPathOptions = {}): Promise<string> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
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
    nextPromptSnippet,
    handoffSnippet
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
    readOptionalAbsoluteSnippet(paths.nextPrompt, workspaceRoot, FILE_SNIPPET_LIMIT),
    readOptionalAbsoluteSnippet(paths.handoff, workspaceRoot, FILE_SNIPPET_LIMIT)
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
    renderNamedSnippet(".srgical/04-next-agent-prompt.md", nextPromptSnippet),
    "",
    renderNamedSnippet(".srgical/HandoffDoc.md", handoffSnippet)
  ].join("\n");
}

function renderPlanningStateSummary(packState: PlanningPackState): string {
  return [
    `- planId: ${packState.planId}`,
    `- packDir: ${packState.packDir}`,
    `- packPresent: ${packState.packPresent}`,
    `- packMode: ${packState.packMode}`,
    `- mode: ${packState.mode}`,
    `- docsPresent: ${packState.docsPresent}/5`,
    `- readiness: ${packState.readiness.score}/${packState.readiness.total}`,
    `- readinessReadyToWrite: ${packState.readiness.readyToWrite}`,
    `- missingReadinessSignals: ${packState.readiness.missingLabels.join(", ") || "none"}`,
    `- nextRecommended: ${packState.currentPosition.nextRecommended ?? "none queued"}`,
    `- nextStepId: ${packState.nextStepSummary?.id ?? "none"}`,
    `- executionActivated: ${packState.executionActivated}`,
    `- autoRunStatus: ${packState.autoRun?.status ?? "idle"}`
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
