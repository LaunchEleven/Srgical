import { fileExists, listPlanningDirectories, resolveWorkspace } from "./workspace";

type CompletionRequest = {
  words: string[];
  wordIndex: number;
  cwd?: string;
};

type CommandDescriptor = {
  path: string[];
  argStartIndex: number;
  positionalPlan: boolean;
  planOption: boolean;
};

const SUBCOMMANDS_WITH_POSITIONAL_PLAN = new Set(["doctor", "studio", "ssp", "sso", "ssc"]);
const STUDIO_SUBCOMMANDS = new Set(["plan", "operate", "config"]);
const OPTIONS_WITH_VALUES = new Set(["--plan", "--agent", "--max-steps", "--set-reference", "--add-reference"]);

export async function completeCliValues(request: CompletionRequest): Promise<string[]> {
  const completion = extractPlanCompletionRequest(request);

  if (!completion) {
    return [];
  }

  return listMatchingPlanIds(completion.workspace, completion.prefix);
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

    if (normalizedPrefix.length > 0 && !ref.planId.toLowerCase().startsWith(normalizedPrefix)) {
      continue;
    }

    matches.push(ref.planId);
  }

  return matches;
}

function extractPlanCompletionRequest(
  request: CompletionRequest
): {
  prefix: string;
  workspace?: string;
} | null {
  if (request.wordIndex < 0 || request.words.length === 0) {
    return null;
  }

  const descriptor = parseCommandDescriptor(request.words);

  if (!descriptor) {
    return null;
  }

  const currentWord = request.words[request.wordIndex] ?? "";

  if (descriptor.planOption && request.wordIndex > 0 && request.words[request.wordIndex - 1] === "--plan") {
    return {
      prefix: currentWord.startsWith("-") ? "" : currentWord,
      workspace: extractWorkspaceCandidate(request.words, descriptor, request.wordIndex)
    };
  }

  if (descriptor.positionalPlan && request.wordIndex === descriptor.argStartIndex && !currentWord.startsWith("-")) {
    return {
      prefix: currentWord,
      workspace: request.cwd
    };
  }

  return null;
}

function parseCommandDescriptor(words: string[]): CommandDescriptor | null {
  const topLevel = words[0] ?? "";

  if (!topLevel) {
    return null;
  }

  if (topLevel === "run-next") {
    return {
      path: ["run-next"],
      argStartIndex: 1,
      positionalPlan: false,
      planOption: true
    };
  }

  if (topLevel === "studio") {
    const subcommand = words[1] ?? "";

    if (STUDIO_SUBCOMMANDS.has(subcommand)) {
      return {
        path: ["studio", subcommand],
        argStartIndex: 2,
        positionalPlan: true,
        planOption: true
      };
    }

    return {
      path: ["studio"],
      argStartIndex: 1,
      positionalPlan: true,
      planOption: true
    };
  }

  if (SUBCOMMANDS_WITH_POSITIONAL_PLAN.has(topLevel)) {
    return {
      path: [topLevel],
      argStartIndex: 1,
      positionalPlan: true,
      planOption: topLevel !== "ssp" && topLevel !== "sso" && topLevel !== "ssc" ? true : true
    };
  }

  return null;
}

function extractWorkspaceCandidate(words: string[], descriptor: CommandDescriptor, stopIndexExclusive: number): string | undefined {
  const positionals: string[] = [];
  let optionAwaitingValue: string | null = null;

  for (let index = descriptor.argStartIndex; index < stopIndexExclusive; index += 1) {
    const token = words[index];

    if (!token) {
      continue;
    }

    if (optionAwaitingValue) {
      optionAwaitingValue = null;
      continue;
    }

    if (token.startsWith("-")) {
      optionAwaitingValue = OPTIONS_WITH_VALUES.has(token) ? token : null;
      continue;
    }

    positionals.push(token);
  }

  return positionals[0];
}
