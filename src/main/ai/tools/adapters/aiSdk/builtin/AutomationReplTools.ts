import type { CallToolResult } from '@modelcontextprotocol/server'
import { tool } from 'ai'

import { automationReplDescription, automationReplInput, automationReplResetInput } from '@main/ai/tools/automationRepl'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export function createAutomationReplToolEntries(): ToolEntry[] {
  return [false, true].map((reset) => ({
    name: reset ? 'automation_repl_reset' : 'automation_repl',
    namespace: 'automation',
    description: reset
      ? 'Reset automation JS state and release control leases; user-stopped control remains stopped.'
      : automationReplDescription,
    defer: 'never',
    truncatable: false,
    applies: (scope) => scope.browserEnabled === true || scope.computerUseEnabled === true,
    tool: tool<Record<string, unknown>, CallToolResult>({
      description: reset
        ? 'Reset automation JS state and release control leases; user-stopped control remains stopped.'
        : automationReplDescription,
      inputSchema: reset ? automationReplResetInput : automationReplInput,
      execute: async (args, options) => {
        const { request } = getToolCallContext(options)
        const run = await request.automationRun?.()
        if (!run) throw new Error('Automation requires a conversation-owned run')
        if (reset) return run.reset()
        return run.execute(automationReplInput.parse(args).code, options.abortSignal)
      },
      toModelOutput: ({ output }) => ({
        type: 'content',
        value: output.content.flatMap<
          { type: 'text'; text: string } | { type: 'image-data'; data: string; mediaType: string }
        >((part) => {
          if (part.type === 'text') return [{ type: 'text', text: part.text }]
          if (part.type === 'image') return [{ type: 'image-data', data: part.data, mediaType: part.mimeType }]
          return []
        })
      })
    })
  }))
}
