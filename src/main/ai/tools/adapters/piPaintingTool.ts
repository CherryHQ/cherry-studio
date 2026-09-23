import type { AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'

import { generatedImageResultSchema, isGeneratedImageToolName } from '@shared/ai/generateImageTool'

/** Publish completed painting results independently of the enclosing code-mode script's return value. */
export function withPiPaintingResults<T extends ToolDefinition>(
  tools: readonly T[],
  publish: (event: AgentSessionEvent) => void
): T[] {
  return tools.map((tool) => {
    if (!isGeneratedImageToolName(tool.name)) return tool
    return {
      ...tool,
      async execute(...args: Parameters<ToolDefinition['execute']>) {
        const result = await tool.execute(...args)
        if (generatedImageResultSchema.safeParse(result.details).success) {
          const [toolCallId, input] = args
          publish({ type: 'tool_execution_start', toolCallId, toolName: tool.name, args: input })
          publish({ type: 'tool_execution_end', toolCallId, toolName: tool.name, isError: false, result })
        }
        return result
      }
    }
  })
}
