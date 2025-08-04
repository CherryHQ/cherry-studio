import { MCPTool } from '@renderer/types'

import { thinkTool } from './think'

export const BUILT_IN_TOOLS: MCPTool[] = [thinkTool]

export function getBuiltInTool(name: string): MCPTool | undefined {
  return BUILT_IN_TOOLS.find((tool) => tool.name === name || tool.id === name)
}

export function isBuiltInTool(tool: MCPTool): boolean {
  return tool.isBuiltIn === true
}

export * from './think'
