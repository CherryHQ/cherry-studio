import { diagnosticReportService } from '@data/services/DiagnosticReportService'
import {
  type DiagnosticReportSchemas,
  ListDiagnosticReportsQuerySchema
} from '@shared/data/api/schemas/diagnosticReports'
import type { HandlersFor } from '@shared/data/api/types'

export const diagnosticReportHandlers: HandlersFor<DiagnosticReportSchemas> = {
  '/diagnostic-reports': {
    GET: async ({ query }) => {
      const { page, limit } = ListDiagnosticReportsQuerySchema.parse(query ?? {})
      return diagnosticReportService.list(page, limit)
    }
  }
}
