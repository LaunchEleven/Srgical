import { fileExists, readText, writeText, type PlanningPackPaths } from "./workspace";

export type PlanningDocumentKey = "plan" | "context" | "tracker" | "nextPrompt" | "handoff";
export type PlanningDocumentState = "boilerplate" | "grounded";

type PlanningDocumentSummary = {
  groundedCount: number;
  boilerplateCount: number;
};

const PLANNING_DOC_KEYS: PlanningDocumentKey[] = ["plan", "context", "tracker", "nextPrompt", "handoff"];
const DOC_STATE_MARKER_PREFIX = "<!-- SRGICAL:DOC_STATE ";

export function stampPlanningDocumentState(
  content: string,
  docKey: PlanningDocumentKey,
  state: PlanningDocumentState
): string {
  const marker = `${DOC_STATE_MARKER_PREFIX}${JSON.stringify({ version: 1, docKey, state })} -->`;
  const normalizedContent = content.replace(/^\uFEFF/, "");

  if (normalizedContent.startsWith(DOC_STATE_MARKER_PREFIX)) {
    return normalizedContent.replace(/^<!-- SRGICAL:DOC_STATE .*?-->\r?\n\r?\n?/, `${marker}\n\n`);
  }

  return `${marker}\n\n${normalizedContent}`;
}

export async function applyPlanningPackDocumentState(
  paths: PlanningPackPaths,
  state: PlanningDocumentState
): Promise<void> {
  await Promise.all(
    PLANNING_DOC_KEYS.map(async (docKey) => {
      const filePath = paths[docKey];

      if (!(await fileExists(filePath))) {
        return;
      }

      const content = await readText(filePath);
      await writeText(filePath, stampPlanningDocumentState(content, docKey, state));
    })
  );
}

export async function readPlanningPackDocumentSummary(
  paths: PlanningPackPaths,
  fallbackState: PlanningDocumentState = "boilerplate"
): Promise<PlanningDocumentSummary> {
  let groundedCount = 0;
  let boilerplateCount = 0;

  for (const docKey of PLANNING_DOC_KEYS) {
    const filePath = paths[docKey];

    if (!(await fileExists(filePath))) {
      continue;
    }

    const content = await readText(filePath);
    const parsed = parsePlanningDocumentState(content);
    const effectiveState = parsed?.state ?? fallbackState;

    if (effectiveState === "grounded") {
      groundedCount += 1;
    } else {
      boilerplateCount += 1;
    }
  }

  return {
    groundedCount,
    boilerplateCount
  };
}

function parsePlanningDocumentState(content: string): { docKey: PlanningDocumentKey; state: PlanningDocumentState } | null {
  const match = /^<!-- SRGICAL:DOC_STATE (.+?) -->/.exec(content.replace(/^\uFEFF/, ""));

  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as {
      docKey?: unknown;
      state?: unknown;
    };

    if (
      (parsed.docKey === "plan" ||
        parsed.docKey === "context" ||
        parsed.docKey === "tracker" ||
        parsed.docKey === "nextPrompt" ||
        parsed.docKey === "handoff") &&
      (parsed.state === "boilerplate" || parsed.state === "grounded")
    ) {
      return {
        docKey: parsed.docKey,
        state: parsed.state
      };
    }
  } catch {
    return null;
  }

  return null;
}
