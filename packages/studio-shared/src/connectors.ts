export type McpTransport = "http" | "sse" | "stdio";

export type McpOAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  callbackPort?: number;
};

export type McpServerDefinition = {
  transport: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
  oauth?: McpOAuthConfig;
  timeoutMs?: number;
  alwaysLoad?: boolean;
};

export type ConnectorAuthMethod = "hosted-oauth" | "personal-token" | "oauth-client";

export type ConnectorAuthorizationGuide = {
  method: ConnectorAuthMethod;
  actionLabel: string;
  steps: string[];
  environmentVariables?: string[];
};

export type ConnectorPreset = {
  presetId: string;
  label: string;
  description: string;
  category: string;
  authDescription: string;
  setupUrl: string;
  authorization: ConnectorAuthorizationGuide;
  definition: McpServerDefinition;
};

export type ConnectorRecord = {
  connectorId: string;
  label: string;
  description: string;
  presetId: string | null;
  enabled: boolean;
  definition: McpServerDefinition;
  createdAt: string;
  updatedAt: string;
  missingEnvironmentVariables: string[];
  status: ConnectorStatus;
  statusDetail: string | null;
  tools: ConnectorTool[];
};

export type ConnectorStatus =
  | "ready"
  | "missing-environment"
  | "connected"
  | "failed"
  | "needs-auth"
  | "pending"
  | "disabled";

export type ConnectorTool = {
  name: string;
  description?: string;
  readOnly?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
};

export type ConnectorRegistrySnapshot = {
  configPath: string;
  catalog: ConnectorPreset[];
  connectors: ConnectorRecord[];
  enabledCount: number;
  readyCount: number;
};

export type ResolvedMcpServerDefinition = Omit<McpServerDefinition, "headers" | "env" | "oauth"> & {
  headers?: Record<string, string>;
  env?: Record<string, string>;
  oauth?: McpOAuthConfig;
};
