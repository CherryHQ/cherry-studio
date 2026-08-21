/**
 * Tool names exposed by the in-process `assistant` MCP server.
 *
 * Declared in the approval layer — which already owns every Cherry tool's canonical identity — so
 * the server, the policy registry and the built-in Agents' capability table name the same tools
 * without importing each other. Deliberately import-free: `mcp/servers/assistant.ts` depends on
 * this, so anything it pulled in would close a cycle back through the MCP layer.
 */

export const ASSISTANT_TOOL_NAMES = ['navigate', 'diagnose', 'product_info', 'apply_setting', 'create_agent'] as const

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number]
