import type { CallToolResult } from '@modelcontextprotocol/server'
import { tool } from 'ai'

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
    tool: tool<Record<string, unknown>, CallToolResult>({
      description,
      inputSchema,
      execute: (args, options) => {
        const { request } = getToolCallContext(options)
        if (!request.computerUseTask) throw new Error('Computer Use requires a host-owned control task')
        return callComputerUseTool(request.computerUseTask, name, args, options.abortSignal)
      },
      toModelOutput: ({ output }: { output: CallToolResult }) => ({
        type: 'content',
        value: output.content.flatMap<
          { type: 'text'; text: string } | { type: 'image-data'; data: string; mediaType: string }
        >((part) => {
          if (part.type === 'text') return [{ type: 'text' as const, text: part.text }]
          if (part.type === 'image') return [{ type: 'image-data' as const, data: part.data, mediaType: part.mimeType }]
          return []
        })
      })
    })
  }))
}
