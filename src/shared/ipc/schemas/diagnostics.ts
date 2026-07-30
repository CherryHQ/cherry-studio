import * as z from 'zod'

import { defineRoute } from '../define'

export const diagnosticRangeSchema = z.enum(['24h', '3d', '7d'])
export type DiagnosticRange = z.infer<typeof diagnosticRangeSchema>

const diagnosticWarningSchema = z.enum([
  'malformed_lines',
  'size_limit_reached',
  'source_changed',
  'source_unreadable',
  'system_info_unavailable'
])
export type DiagnosticWarning = z.infer<typeof diagnosticWarningSchema>

const diagnosticSourceSummarySchema = z.object({
  available: z.boolean(),
  estimatedBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative()
})

const diagnosticSourceStatsSchema = z.object({
  bytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  malformedLineCount: z.number().int().nonnegative()
})

const diagnosticTimeRangeSchema = z.object({
  from: z.string(),
  to: z.string()
})

export const diagnosticsRequestSchemas = {
  'diagnostics.bundle.inspect': defineRoute({
    input: z.object({ range: diagnosticRangeSchema }).strict(),
    output: z.object({
      range: diagnosticTimeRangeSchema,
      sourceLimitBytes: z.number().int().positive(),
      sources: z.object({
        crashDumps: diagnosticSourceSummarySchema,
        logs: diagnosticSourceSummarySchema,
        traces: diagnosticSourceSummarySchema
      }),
      warnings: z.array(diagnosticWarningSchema)
    })
  }),
  'diagnostics.bundle.export': defineRoute({
    input: z
      .object({
        includeLogs: z.boolean(),
        includeTraces: z.boolean(),
        range: diagnosticRangeSchema
      })
      .strict(),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('busy') }),
      z.object({ status: z.literal('canceled') }),
      z.object({
        archiveBytes: z.number().int().nonnegative(),
        bundleId: z.string(),
        fileName: z.string(),
        included: z.object({
          logs: diagnosticSourceStatsSchema,
          traces: diagnosticSourceStatsSchema
        }),
        omitted: z.object({
          logs: diagnosticSourceStatsSchema,
          traces: diagnosticSourceStatsSchema
        }),
        range: diagnosticTimeRangeSchema,
        status: z.literal('saved'),
        warnings: z.array(diagnosticWarningSchema)
      })
    ])
  }),
  'diagnostics.bundle.reveal': defineRoute({
    input: z.void(),
    output: z.boolean()
  })
}
