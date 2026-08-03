/** The in-process MCP server id that hosts the cherry builtin tools. */
export const CHERRY_BUILTIN_MCP_SERVER = 'cherry-tools'

/** Build the fully-qualified runtime name the agent SDK uses to invoke a cherry builtin tool. */
export const toCherryBuiltinRuntimeName = (toolName: string): string => `mcp__${CHERRY_BUILTIN_MCP_SERVER}__${toolName}`
