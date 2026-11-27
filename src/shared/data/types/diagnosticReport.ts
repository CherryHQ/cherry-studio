import * as z from 'zod'

export const DiagnosticProcessingStatusSchema = z.enum([
  'pending',
  'unprocessed',
  'investigating',
  'resolved',
  'closed'
])
export type DiagnosticProcessingStatus = z.infer<typeof DiagnosticProcessingStatusSchema>

export interface DiagnosticReportEntity {
  reportId: string
  submittedAt: number
  processingStatus: DiagnosticProcessingStatus | null
  lastCheckedAt: number | null
}
