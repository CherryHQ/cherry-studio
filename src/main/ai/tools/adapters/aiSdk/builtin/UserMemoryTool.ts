import { tool } from 'ai'

import {
  appendMemoryJournal,
  readMemoryFacts,
  searchMemoryJournal,
  updateMemoryFacts
} from '@main/ai/agents/memoryFiles'
import { assistantMemoryFiles } from '@main/ai/assistantMemory'
import { USER_MEMORY_TOOL_NAME, userMemoryInputSchema } from '@shared/ai/builtinTools'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export function createUserMemoryToolEntry(): ToolEntry {
  return {
    name: USER_MEMORY_TOOL_NAME,
    namespace: 'memory',
    description: 'Read shared user facts or search events; update facts or append events with approval.',
    defer: 'never',
    truncatable: false,
    applies: (scope) => scope.userMemoryEnabled === true,
    tool: tool({
      description:
        'Shared user memory across enabled assistants and agents. Read before update and provide expectedRevision. Preserve useful facts; on MEMORY_CONFLICT re-read and reconcile. Record only durable user-wide facts, not one-off instructions or project details. No Agent-local files are accessible.',
      inputSchema: userMemoryInputSchema,
      needsApproval: ({ action }) => action === 'update' || action === 'append',
      execute: async (input, options) => {
        const { request } = getToolCallContext(options)
        const files = assistantMemoryFiles(request.userMemoryContext)
        switch (input.action) {
          case 'read':
            return readMemoryFacts(files)
          case 'update':
            return updateMemoryFacts(files, input.content, input.expectedRevision)
          case 'append':
            return appendMemoryJournal(files, input.text, input.tags)
          case 'search':
            return (await searchMemoryJournal(files, input.query, input.tag, input.limit)) ?? []
        }
      }
    })
  }
}
