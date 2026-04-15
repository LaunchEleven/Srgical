import { fileExists, listPlanningDirectories, resolveWorkspace } from "./workspace";

type CompletionRequest = {
  words: string[];
  wordIndex: number;
  cwd?: string;
};

const COMMANDS_WITH_POSITIONAL_PLAN = new Set(["prepare", "operate", "status"]);

export async function completeCliValues(request: CompletionRequest): Promise<string[]> {
  const currentWord = request.words[request.wordIndex] ?? "";
  const topLevel = request.words[0] ?? "";

  if (!topLevel || request.wordIndex < 0) {
    return [];
  }

  if (request.wordIndex > 0 && request.words[request.wordIndex - 1] === "--plan") {
    return listMatchingPlanIds(request.cwd, currentWord);
  }

  if (COMMANDS_WITH_POSITIONAL_PLAN.has(topLevel) && request.wordIndex === 1 && !currentWord.startsWith("-")) {
    return listMatchingPlanIds(request.cwd, currentWord);
  }

  return [];
}

export function renderCompletionScript(shell: string): string {
  const normalized = shell.trim().toLowerCase();

  if (normalized === "bash") {
    return renderBashCompletionScript();
  }

  if (normalized === "powershell" || normalized === "pwsh") {
    return renderPowerShellCompletionScript();
  }

  throw new Error("Unsupported shell. Use `bash` or `powershell`.");
}

export function renderBashCompletionScript(): string {
  return `# srgical bash completion
_srgical_completion() {
  local index=$((COMP_CWORD - 1))
  local args=("\${COMP_WORDS[@]:1}")
  local suggestions

  suggestions="$(srgical __complete --index "$index" -- "\${args[@]}" 2>/dev/null)" || return 0
  COMPREPLY=()

  while IFS= read -r line; do
    if [[ -n "$line" ]]; then
      COMPREPLY+=("$line")
    fi
  done <<< "$suggestions"
}

complete -F _srgical_completion srgical
`;
}

export function renderPowerShellCompletionScript(): string {
  return `# srgical PowerShell completion
Register-ArgumentCompleter -Native -CommandName srgical -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $elements = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text })
  $index = if ([string]::IsNullOrEmpty($wordToComplete)) { $elements.Count } else { $elements.Count - 1 }

  if ($index -lt 0) {
    return
  }

  $suggestions = & srgical __complete --index $index -- @elements 2>$null

  foreach ($suggestion in $suggestions) {
    if (-not [string]::IsNullOrWhiteSpace($suggestion)) {
      [System.Management.Automation.CompletionResult]::new($suggestion, $suggestion, 'ParameterValue', $suggestion)
    }
  }
}
`;
}

async function listMatchingPlanIds(workspaceCandidate: string | undefined, prefix: string): Promise<string[]> {
  const workspace = resolveWorkspace(workspaceCandidate);
  const normalizedPrefix = prefix.trim().toLowerCase();
  const refs = await listPlanningDirectories(workspace);
  const matches: string[] = [];

  for (const ref of refs) {
    if (!(await fileExists(ref.dir))) {
      continue;
    }

    if (normalizedPrefix && !ref.planId.toLowerCase().startsWith(normalizedPrefix)) {
      continue;
    }

    matches.push(ref.planId);
  }

  return matches;
}
