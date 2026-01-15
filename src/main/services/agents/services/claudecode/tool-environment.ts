import type { Tool, ToolEnvironment } from '@types'

import { builtinTools } from './tools'

/**
 * Default environment when supportedEnvironments is not specified.
 * For backwards compatibility, tools without explicit environment support are electron-only.
 */
const DEFAULT_ENVIRONMENT: ToolEnvironment = 'electron'

/**
 * Check if a tool is supported in a given environment.
 *
 * @param tool - The tool to check
 * @param environment - The target environment ('electron' or 'browser')
 * @returns true if the tool is supported in the environment
 */
export function isToolSupportedInEnvironment(tool: Tool, environment: ToolEnvironment): boolean {
  const supportedEnvs = tool.supportedEnvironments ?? [DEFAULT_ENVIRONMENT]
  return supportedEnvs.includes(environment)
}

/**
 * Filter tools to only those supported in a given environment.
 *
 * @param tools - Array of tools to filter
 * @param environment - The target environment ('electron' or 'browser')
 * @returns Filtered array of tools supported in the environment
 */
export function filterToolsByEnvironment(tools: Tool[], environment: ToolEnvironment): Tool[] {
  return tools.filter((tool) => isToolSupportedInEnvironment(tool, environment))
}

/**
 * Get builtin tools for a specific environment.
 * This is the primary API for agents to retrieve available tools.
 *
 * @param environment - Optional target environment. If not specified, returns all tools (electron default).
 * @returns Array of builtin tools available in the specified environment
 *
 * @example
 * // Get all tools (default electron environment)
 * const tools = getBuiltinTools()
 *
 * // Get only browser-compatible tools
 * const browserTools = getBuiltinTools('browser')
 *
 * // Get electron-specific tools
 * const electronTools = getBuiltinTools('electron')
 */
export function getBuiltinTools(environment?: ToolEnvironment): Tool[] {
  if (!environment) {
    // No environment specified - return all tools (backwards compatible)
    return builtinTools
  }
  return filterToolsByEnvironment(builtinTools, environment)
}

/**
 * Get all tool IDs that are NOT supported in a given environment.
 * Useful for generating disallowed_tools lists.
 *
 * @param tools - Array of tools to check
 * @param environment - The target environment ('electron' or 'browser')
 * @returns Array of tool IDs that are not supported
 */
export function getUnsupportedToolIds(tools: Tool[], environment: ToolEnvironment): string[] {
  return tools.filter((tool) => !isToolSupportedInEnvironment(tool, environment)).map((tool) => tool.id)
}

/**
 * Get IDs of builtin tools that are NOT supported in a given environment.
 * Useful for generating disallowed_tools lists for Claude SDK.
 *
 * @param environment - The target environment ('electron' or 'browser')
 * @returns Array of tool IDs that are not supported
 *
 * @example
 * // Get tools to disable in browser environment
 * const disabledTools = getDisabledBuiltinToolIds('browser')
 * // Returns: ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'NotebookEdit', 'NotebookRead', 'Task']
 */
export function getDisabledBuiltinToolIds(environment: ToolEnvironment): string[] {
  return getUnsupportedToolIds(builtinTools, environment)
}

/**
 * Get all tool IDs that ARE supported in a given environment.
 *
 * @param tools - Array of tools to check
 * @param environment - The target environment ('electron' or 'browser')
 * @returns Array of tool IDs that are supported
 */
export function getSupportedToolIds(tools: Tool[], environment: ToolEnvironment): string[] {
  return tools.filter((tool) => isToolSupportedInEnvironment(tool, environment)).map((tool) => tool.id)
}

/**
 * Partition tools into supported and unsupported for a given environment.
 *
 * @param tools - Array of tools to partition
 * @param environment - The target environment ('electron' or 'browser')
 * @returns Object with supported and unsupported tool arrays
 */
export function partitionToolsByEnvironment(
  tools: Tool[],
  environment: ToolEnvironment
): {
  supported: Tool[]
  unsupported: Tool[]
} {
  const supported: Tool[] = []
  const unsupported: Tool[] = []

  for (const tool of tools) {
    if (isToolSupportedInEnvironment(tool, environment)) {
      supported.push(tool)
    } else {
      unsupported.push(tool)
    }
  }

  return { supported, unsupported }
}
