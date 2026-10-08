import { tool } from 'ai'

import type { NeutralToolResult } from '@main/ai/agents/tools/types'
import { callComputerUseTool, computerUseToolDefinitions } from '@main/ai/tools/computerUse'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export function createComputerUseToolEntries(): ToolEntry[] {
  return computerUseToolDefinitions.map(({ name, description, inputSchema }) => ({
    name: `computer_${name}`,
    namespace: 'computer',
    description,
    defer: 'never',
    truncatable: false,
    applies: (scope) => scope.computerUseEnabled === true,
    tool: tool<Record<string, unknown>, NeutralToolResult>({
      description,
      inputSchema,
      execute: (args, options) => {
        const { request } = getToolCallContext(options)
        if (!request.computerUseTask) throw new Error('Computer Use requires a host-owned control task')
        return callComputerUseTool(request.computerUseTask, name, args, options.abortSignal)
      },
      toModelOutput: ({ output }: { output: NeutralToolResult }) => ({
        type: 'content',
        value: output.content.map((part) =>
          part.type === 'image' ? { type: 'image-data' as const, data: part.data, mediaType: part.mimeType } : part
        )
      })
    })
  }))
}
