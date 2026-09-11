import * as z from 'zod'

import { AbsoluteFilePathSchema } from '@shared/types/file'
import { DIAGNOSTIC_DESCRIPTION_MAX_BYTES, diagnosticDescriptionByteLength } from '@shared/utils/diagnostics'

import { defineRoute } from '../define'

export const diagnosticRangeSchema = z.enum(['24h', '3d', '7d'])
export type DiagnosticRange = z.infer<typeof diagnosticRangeSchema>

export const diagnosticUploadFailureReasonSchema = z.enum([
  'invalid_archive',
  'archive_too_large',
  'authentication_failed',
  'rate_limited',
  'service_unavailable',
  'submission_rejected'
])
export type DiagnosticUploadFailureReason = z.infer<typeof diagnosticUploadFailureReasonSchema>

const diagnosticSourceSummarySchema = z.object({
  available: z.boolean(),
  estimatedBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative()
})

const diagnosticChatSourceSummarySchema = z.object({
  available: z.boolean(),
  estimatedBytes: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative()
})

const diagnosticBundleInputSchema = z
  .object({
    includeChatRecords: z.boolean(),
    includeLogs: z.boolean(),
    includeTraces: z.boolean(),
    range: diagnosticRangeSchema
  })
  .strict()

const diagnosticDescriptionSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1))
  .refine((value) => diagnosticDescriptionByteLength(value) <= DIAGNOSTIC_DESCRIPTION_MAX_BYTES)

const diagnosticUploadInputSchema = diagnosticBundleInputSchema.extend({ description: diagnosticDescriptionSchema })

const nonblankStringSchema = z.string().refine((value) => value.trim().length > 0)

const diagnosticRetainedUploadSchema = z.object({
  bundleId: z.string().uuid(),
  fileName: z.string()
})

const diagnosticUploadResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('busy') }),
  z.object({ reportId: nonblankStringSchema, status: z.literal('uploaded') }),
  diagnosticRetainedUploadSchema.extend({
    reason: diagnosticUploadFailureReasonSchema,
    status: z.literal('submission_failed')
  }),
  diagnosticRetainedUploadSchema.extend({ status: z.literal('submission_unknown') })
])

export const diagnosticsRequestSchemas = {
  'diagnostics.bundle.inspect': defineRoute({
    input: z.object({ range: diagnosticRangeSchema }).strict(),
    output: z.object({
      hasWarnings: z.boolean(),
      sourceLimitBytes: z.number().int().positive(),
      sources: z.object({
        chatRecords: diagnosticChatSourceSummarySchema,
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
    input: diagnosticUploadInputSchema,
    output: diagnosticUploadResultSchema
  }),
  'diagnostics.bundle.retry_upload': defineRoute({
    input: z.object({ bundleId: z.string().uuid() }).strict(),
    output: diagnosticUploadResultSchema
  }),
  'diagnostics.bundle.save_upload': defineRoute({
    input: z.object({ bundleId: z.string().uuid() }).strict(),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('busy') }),
      z.object({ status: z.literal('canceled') }),
      diagnosticRetainedUploadSchema.extend({
        filePath: AbsoluteFilePathSchema,
        status: z.literal('saved')
      })
    ])
  }),
  'diagnostics.bundle.discard_upload': defineRoute({
    input: z.object({ bundleId: z.string().uuid() }).strict(),
    output: z.object({ status: z.enum(['busy', 'discarded', 'not_found']) })
  })
}
