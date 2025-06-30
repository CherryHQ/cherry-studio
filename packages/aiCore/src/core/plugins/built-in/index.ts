/**
 * 内置插件命名空间
 * 所有内置插件都以 'built-in:' 为前缀
 */
export const BUILT_IN_PLUGIN_PREFIX = 'built-in:'

export { createLoggingPlugin } from './logging'
export type { MCPPromptConfig, ToolUseResult } from './mcpPromptPlugin'
export { createMCPPromptPlugin } from './mcpPromptPlugin'
