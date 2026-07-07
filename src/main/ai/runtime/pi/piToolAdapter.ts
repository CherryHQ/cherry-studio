import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { MemoryToolContext } from '@main/ai/agents/tools/memoryTools'
import { memoryTool } from '@main/ai/agents/tools/memoryTools'
import type { NeutralTool, NeutralToolContent } from '@main/ai/agents/tools/types'
import { type CherryAgentContext, CherryAutonomyTools } from '@main/ai/mcp/servers/cherryAutonomyTools'

/** Maps Cherry's runtime-neutral and autonomy tools to pi custom tools. */

function joinTextContent(content: readonly { type: string; text?: string }[]): string {
  return content.map((part) => (part.type === 'text' ? (part.text ?? '') : '[image]')).join('\n')
}

/** Map one neutral tool (bound to its context) to a pi `ToolDefinition`. */
export function toPiToolDefinition<Ctx>(tool: NeutralTool<Ctx>, ctx: Ctx): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params) {
      const result = await tool.handler(params as Record<string, unknown>, ctx)
      if (result.isError) throw new Error(joinTextContent(result.content))
      return { content: result.content, details: undefined }
    }
  }
}

/** Build the autonomy tools from the same implementation used by the Claude MCP surface. */
export function buildAutonomyToolDefinitions(
  autonomyContext: CherryAgentContext,
  memoryContext: MemoryToolContext
): ToolDefinition[] {
  const autonomy = new CherryAutonomyTools(autonomyContext)
  const autonomyTools = autonomy.tools().map<ToolDefinition>((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description ?? tool.name,
    parameters: tool.inputSchema as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params) {
      const result = await autonomy.call(tool.name, params as Record<string, string | undefined>)
      if (result.isError) throw new Error(joinTextContent(result.content))
      return { content: result.content as NeutralToolContent[], details: undefined }
    }
  }))

  return [...autonomyTools, toPiToolDefinition(memoryTool, memoryContext)]
}

/** Auto-approved because scheduled/headless turns have no interactive responder. */
export const AUTONOMY_TOOL_NAMES: ReadonlySet<string> = new Set(['cron', 'notify', 'config', memoryTool.name])
