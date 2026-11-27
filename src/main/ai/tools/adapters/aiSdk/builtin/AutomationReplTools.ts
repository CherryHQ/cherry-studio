import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { tool } from 'ai'

import { loggerService } from '@logger'
import {
  automationReplDescription,
  automationReplInput,
  automationReplResetInput,
  buildAutomationReplDescription
} from '@main/ai/tools/automationRepl'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const logger = loggerService.withContext('AutomationReplTools')
const UNREADABLE_OUTPUT_NOTE =
  'This automation tool result could not be read back from the conversation history. Ignore it and observe the current state again before acting.'

function automationReplModelOutput(output: unknown): ToolResultOutput {
  const unreadable = { type: 'text', value: UNREADABLE_OUTPUT_NOTE } as const
  if (
    typeof output !== 'object' ||
    output === null ||
    Array.isArray(output) ||
    !('content' in output) ||
    !Array.isArray(output.content)
  ) {
    return unreadable
  }

  const value: Extract<ToolResultOutput, { type: 'content' }>['value'] = []
  for (const part of output.content) {
    if (typeof part !== 'object' || part === null || Array.isArray(part) || typeof part.type !== 'string') {
      return unreadable
    }
    if (part.type === 'text') {
      if (typeof part.text !== 'string') return unreadable
      value.push({ type: 'text', text: part.text })
    } else if (part.type === 'image') {
      if (typeof part.data !== 'string' || typeof part.mimeType !== 'string') return unreadable
      value.push({ type: 'image-data', data: part.data, mediaType: part.mimeType })
    }
  }
  return { type: 'content', value }
}

export function createAutomationReplToolEntries(): ToolEntry[] {
  return [false, true].map((reset) => {
    const name = reset ? 'automation_repl_reset' : 'automation_repl'
    const fallbackTool = tool<Record<string, unknown>, CallToolResult>({
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
      toModelOutput: ({ output, toolCallId }) => {
        const result = automationReplModelOutput(output)
        if (result.type === 'text') {
          logger.warn('Unreadable automation tool output', {
            toolName: name,
            toolCallId,
            reason: 'invalid-output-shape'
          })
        }
        return result
      }
    })
    return {
      name,
      namespace: 'automation',
      description: reset
        ? 'Reset automation JS state and release control leases; user-stopped control remains stopped.'
        : "Execute standard JavaScript in the persistent automation REPL, with only this request's enabled capabilities.",
      defer: 'never',
      truncatable: false,
      applies: (scope) => scope.browserEnabled === true || scope.computerUseEnabled === true,
      tool: fallbackTool,
      ...(!reset && {
        buildTool: (scope) => ({
          ...fallbackTool,
          description: buildAutomationReplDescription({
            browser: scope.browserEnabled === true,
            computer: scope.computerUseEnabled === true
          })
        })
      })
    }
  })
}
