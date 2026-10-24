import * as z from 'zod'

import { MemoryFactsSchema, MemoryJournalEntrySchema } from '@shared/ai/agentMemory'

import { defineRoute } from '../define'

export const memoryRequestSchemas = {
  'memory.user.facts.read': defineRoute({
    input: z.void(),
    output: MemoryFactsSchema
  }),
  'memory.user.facts.update': defineRoute({
    input: z.object({ content: z.string(), expectedRevision: z.string().min(1) }),
    output: MemoryFactsSchema
  }),
  'memory.user.journal.search': defineRoute({
    input: z.object({
      query: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().positive().max(200).default(50)
    }),
    output: z.array(MemoryJournalEntrySchema)
  })
}
