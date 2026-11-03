import * as z from 'zod'

import { HistorySourceSchema } from '@shared/data/types/conversationImport'

import { defineRoute } from '../define'

export const ImportDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(['warning', 'error']),
  path: z.string(),
  line: z.number().int().optional()
})
export type ImportDiagnostic = z.infer<typeof ImportDiagnosticSchema>

export const ImportCandidateSchema = z.object({
  ref: z.string(),
  title: z.string(),
  sourcePath: z.string()
})
const ImportSelectionSchema = z.strictObject({
  ref: z.string(),
  branchId: z.string().optional(),
  directory: z.string().optional()
})
export const ImportPreviewItemSchema = ImportCandidateSchema.extend({
  originalSessionId: z.string(),
  branches: z.array(z.string()),
  branchId: z.string().optional(),
  originalDirectory: z.string().optional(),
  directory: z.string().optional(),
  messageCount: z.number(),
  models: z.array(z.string()),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  diagnostics: z.array(ImportDiagnosticSchema),
  skippedRecords: z.number(),
  downgradedParts: z.number(),
  existing: z.object({ sessionId: z.string(), agentId: z.string().nullable(), inTrash: z.boolean() }).optional()
})
export type ImportCandidate = z.infer<typeof ImportCandidateSchema>
export type ImportSelection = z.infer<typeof ImportSelectionSchema>
export type ImportPreviewItem = z.infer<typeof ImportPreviewItemSchema>
const ImportOutcomeSchema = z.object({
  ref: z.string(),
  status: z.enum(['imported', 'existing', 'failed', 'unprocessed']),
  sessionId: z.string().optional(),
  agentId: z.string().nullable().optional(),
  initialization: z.enum(['ready', 'failed']).optional(),
  reason: z.string().optional()
})
export type ImportOutcome = z.infer<typeof ImportOutcomeSchema>
export const conversationImportRequestSchemas = {
  'conversation_import.discover': defineRoute({
    input: z.strictObject({ source: HistorySourceSchema, root: z.string().min(1).optional() }),
    output: z.object({ scanId: z.string(), root: z.string(), candidates: z.array(ImportCandidateSchema) })
  }),
  'conversation_import.preview': defineRoute({
    input: z.strictObject({
      scanId: z.string(),
      targetAgentId: z.string().min(1),
      selections: z.array(ImportSelectionSchema).min(1).max(100)
    }),
    output: z.object({ previewId: z.string(), expiresAt: z.number(), items: z.array(ImportPreviewItemSchema) })
  }),
  'conversation_import.commit': defineRoute({
    input: z.strictObject({ previewId: z.string(), refs: z.array(z.string()).min(1).max(100) }),
    output: z.array(ImportOutcomeSchema)
  }),
  'conversation_import.cancel': defineRoute({ input: z.void(), output: z.void() }),
  'conversation_import.retry_initialization': defineRoute({
    input: z.strictObject({ sessionId: z.string().min(1) }),
    output: z.void()
  })
}
