import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { DiagnosticProcessingStatus } from '@shared/data/types/diagnosticReport'

export const diagnosticReportTable = sqliteTable(
  'diagnostic_report',
  {
    reportId: text().primaryKey(),
    submittedAt: integer().notNull(),
    processingStatus: text().$type<DiagnosticProcessingStatus>(),
    lastCheckedAt: integer()
  },
  (table) => [index('diagnostic_report_submitted_at_idx').on(table.submittedAt, table.reportId)]
)

export type DiagnosticReportRow = typeof diagnosticReportTable.$inferSelect
export type InsertDiagnosticReportRow = typeof diagnosticReportTable.$inferInsert
