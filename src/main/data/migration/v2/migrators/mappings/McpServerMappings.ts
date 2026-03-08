/**
 * MCP Server migration mappings and transform functions
 *
 * Transforms legacy Redux MCPServer objects to SQLite mcp_server table rows.
 */

export interface McpServerRow {
  id: string
  name: string
  type: string | null
  description: string | null
  baseUrl: string | null
  command: string | null
  registryUrl: string | null
  args: string[] | null
  env: Record<string, string> | null
  headers: Record<string, string> | null
  provider: string | null
  providerUrl: string | null
  logoUrl: string | null
  tags: string[] | null
  longRunning: boolean | null
  timeout: number | null
  dxtVersion: string | null
  dxtPath: string | null
  reference: string | null
  searchKey: string | null
  configSample: unknown | null
  disabledTools: string[] | null
  disabledAutoApproveTools: string[] | null
  shouldConfig: boolean | null
  isActive: boolean
  installSource: string | null
  isTrusted: boolean | null
  trustedAt: number | null
  installedAt: number | null
}

function toNullable<T>(value: T | undefined | null): T | null {
  return value ?? null
}

export function transformMcpServer(source: Record<string, unknown>): McpServerRow {
  return {
    id: source.id as string,
    name: source.name as string,
    type: toNullable(source.type as string | undefined),
    description: toNullable(source.description as string | undefined),
    baseUrl: toNullable(source.baseUrl as string | undefined),
    command: toNullable(source.command as string | undefined),
    registryUrl: toNullable(source.registryUrl as string | undefined),
    args: toNullable(source.args as string[] | undefined),
    env: toNullable(source.env as Record<string, string> | undefined),
    headers: toNullable(source.headers as Record<string, string> | undefined),
    provider: toNullable(source.provider as string | undefined),
    providerUrl: toNullable(source.providerUrl as string | undefined),
    logoUrl: toNullable(source.logoUrl as string | undefined),
    tags: toNullable(source.tags as string[] | undefined),
    longRunning: toNullable(source.longRunning as boolean | undefined),
    timeout: toNullable(source.timeout as number | undefined),
    dxtVersion: toNullable(source.dxtVersion as string | undefined),
    dxtPath: toNullable(source.dxtPath as string | undefined),
    reference: toNullable(source.reference as string | undefined),
    searchKey: toNullable(source.searchKey as string | undefined),
    configSample: toNullable(source.configSample),
    disabledTools: toNullable(source.disabledTools as string[] | undefined),
    disabledAutoApproveTools: toNullable(source.disabledAutoApproveTools as string[] | undefined),
    shouldConfig: toNullable(source.shouldConfig as boolean | undefined),
    isActive: (source.isActive as boolean) ?? false,
    installSource: toNullable(source.installSource as string | undefined),
    isTrusted: toNullable(source.isTrusted as boolean | undefined),
    trustedAt: toNullable(source.trustedAt as number | undefined),
    installedAt: toNullable(source.installedAt as number | undefined)
  }
}
