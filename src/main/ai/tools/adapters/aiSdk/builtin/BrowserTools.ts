import type { CallToolResult } from '@modelcontextprotocol/server'
import { tool } from 'ai'

import { application } from '@application'
import { sessionToolDefinitions } from '@main/ai/mcp/browserToolDefinitions'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export function createBrowserToolEntries(): ToolEntry[] {
  return sessionToolDefinitions.map(({ name, description, inputSchema }) => ({
    name: `browser_${name}`,
    namespace: 'browser',
    description,
    defer: 'always',
    truncatable: false,
    applies: (scope) => scope.browserEnabled === true,
    tool: tool({
      description,
      // zod v4 keeps the object internals in the inferred type, which the AI
      // SDK's FlexibleSchema overload cannot unify once the tool list is a
      // union of schemas. Runtime validation is unchanged.
      inputSchema: inputSchema as never,
      execute: async (args, options) => {
        const { request } = getToolCallContext(options)
        if (!request.topicId || !request.assistant) throw new Error('Browser tools require a conversation owner')
        return application
          .get('BrowserSessionService')
          .callTopicTool(
            request.topicId,
            request.assistant.id,
            name,
            args,
            AbortSignal.any(
              [options.abortSignal, request.abortSignal].filter((signal): signal is AbortSignal => !!signal)
            )
          )
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
