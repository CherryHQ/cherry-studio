/**
 * Tool names exposed by the in-process `assistant` MCP server.
 *
 * Declared here so the server, the approval registry, and the built-in Agents' capability table
 * all name the same tools without importing each other.
 */

export const ASSISTANT_TOOL_NAMES = ['navigate', 'diagnose', 'product_info', 'apply_setting', 'create_agent'] as const

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number]
