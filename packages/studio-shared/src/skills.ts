export type SkillScope = "global" | "project" | "provider";

export type SkillTrust = "trusted" | "review" | "blocked";

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  source: string;
  rootPath: string;
  manifestPath: string;
  supportingFiles: string[];
  hash: string;
  trust: SkillTrust;
  enabled: boolean;
  effective: boolean;
  shadowedBy: string | null;
  compatibleProviders: string[];
  warnings: string[];
};

export type SkillRegistrySnapshot = {
  globalSkillsDirectory: string;
  discoveredDirectories: string[];
  configuredDirectories: string[];
  skills: SkillRecord[];
  effectiveSkillHashes: string[];
  conflicts: Array<{
    skillId: string;
    sources: string[];
    selectedSource: string;
  }>;
};
