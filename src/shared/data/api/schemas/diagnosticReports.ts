import * as z from 'zod'

import type { DiagnosticReportEntity } from '../../types/diagnosticReport'
import type { OffsetPaginationParams, OffsetPaginationResponse } from '../types'

export const ListDiagnosticReportsQuerySchema = z.strictObject({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(20).default(20)
})
export type ListDiagnosticReportsQuery = z.input<typeof ListDiagnosticReportsQuerySchema> & OffsetPaginationParams

export type DiagnosticReportSchemas = {
  '/diagnostic-reports': {
    GET: {
      query?: ListDiagnosticReportsQuery
      response: OffsetPaginationResponse<DiagnosticReportEntity>
    }
  }
}
