import { AbsoluteFilePathSchema } from '@shared/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

export const diagnosticRangeSchema = z.enum(['24h', '3d', '7d'])
export type DiagnosticRange = z.infer<typeof diagnosticRangeSchema>

export const diagnosticUploadFallbackReasonSchema = z.enum([
  'attachment_upload_failed',
  'form_changed',
  'form_unavailable',
  'network_failed',
  'submission_rejected'
])
export type DiagnosticUploadFallbackReason = z.infer<typeof diagnosticUploadFallbackReasonSchema>

const diagnosticSourceSummarySchema = z.object({
  available: z.boolean(),
  estimatedBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative()
})

const diagnosticBundleSummarySchema = z.object({
  archiveBytes: z.number().int().nonnegative(),
  bundleId: z.string(),
  hasWarnings: z.boolean(),
  includedFileCount: z.number().int().nonnegative(),
  omittedFileCount: z.number().int().nonnegative()
})

const diagnosticBundleInputSchema = z
  .object({
    includeLogs: z.boolean(),
    includeTraces: z.boolean(),
    range: diagnosticRangeSchema
  })
  .strict()

export const diagnosticsRequestSchemas = {
  'diagnostics.bundle.inspect': defineRoute({
    input: z.object({ range: diagnosticRangeSchema }).strict(),
    output: z.object({
      hasWarnings: z.boolean(),
      sourceLimitBytes: z.number().int().positive(),
      sources: z.object({
        crashDumps: z.object({ fileCount: z.number().int().nonnegative() }),
        logs: diagnosticSourceSummarySchema,
        traces: diagnosticSourceSummarySchema
      })
    })
  }),
  'diagnostics.bundle.export': defineRoute({
    input: diagnosticBundleInputSchema,
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('busy') }),
      z.object({ status: z.literal('canceled') }),
      z.object({
        archiveBytes: z.number().int().nonnegative(),
        bundleId: z.string(),
        fileName: z.string(),
        filePath: AbsoluteFilePathSchema,
        hasWarnings: z.boolean(),
        includedFileCount: z.number().int().nonnegative(),
        omittedFileCount: z.number().int().nonnegative(),
        status: z.literal('saved')
      })
    ])
  }),
  'diagnostics.bundle.upload': defineRoute({
    input: diagnosticBundleInputSchema,
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('busy') }),
      diagnosticBundleSummarySchema.extend({ status: z.literal('uploaded') }),
      z.object({
        fileName: z.string(),
        filePath: AbsoluteFilePathSchema,
        reason: diagnosticUploadFallbackReasonSchema,
        status: z.literal('manual_upload_required')
      }),
      diagnosticBundleSummarySchema.extend({
        fileName: z.string(),
        filePath: AbsoluteFilePathSchema,
        status: z.literal('submission_unknown')
      })
    ])
  })
}
