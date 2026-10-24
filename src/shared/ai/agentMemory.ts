import * as z from 'zod'

export const MemoryFactsSchema = z.object({
  content: z.string(),
  revision: z.string(),
  // File write time, not the date any individual fact was stated or confirmed.
  modifiedAt: z.string().optional()
})

export const MemoryJournalEntrySchema = z.object({
  ts: z.string(),
  tags: z.array(z.string()),
  text: z.string()
})

export type MemoryFacts = z.infer<typeof MemoryFactsSchema>
export type MemoryJournalEntry = z.infer<typeof MemoryJournalEntrySchema>
