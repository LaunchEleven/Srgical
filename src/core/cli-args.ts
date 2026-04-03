import { statSync } from "node:fs";
import path from "node:path";

export type ResolvedWorkspacePlanArgs = {
  workspace?: string;
  planId?: string;
};

export function resolveWorkspacePlanArgs(workspaceArg?: string, planIdArg?: string): ResolvedWorkspacePlanArgs {
  if (planIdArg && planIdArg.trim().length > 0) {
    return { workspace: workspaceArg, planId: planIdArg };
  }

  if (!workspaceArg || workspaceArg.trim().length === 0) {
    return { workspace: workspaceArg, planId: undefined };
  }

  if (looksLikeExistingDirectory(workspaceArg)) {
    return { workspace: workspaceArg, planId: undefined };
  }

  return { workspace: undefined, planId: workspaceArg };
}

export function looksLikeExistingDirectory(input: string): boolean {
  try {
    return statSync(path.resolve(input)).isDirectory();
  } catch {
    return false;
  }
}
