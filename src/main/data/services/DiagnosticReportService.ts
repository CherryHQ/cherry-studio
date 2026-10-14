import { desc, eq, sql } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { diagnosticReportTable } from '@data/db/schemas/diagnosticReport'
import type { DiagnosticReportEntity } from '@shared/data/types/diagnosticReport'

export class DiagnosticReportService {
  private get db() {
    return application.get('DbService').getDb()
  }

  record(report: DiagnosticReportEntity): void {
    const inserted = this.db.insert(diagnosticReportTable).values(report).onConflictDoNothing().returning().get()
    if (inserted) notifyDataApiDataChange([{ endpoint: '/diagnostic-reports', kind: 'membership' }])
  }

  updateStatus(reportId: string, processingStatus: NonNullable<DiagnosticReportEntity['processingStatus']>): void {
    const currentStatusRank = sql`
      CASE ${diagnosticReportTable.processingStatus}
        WHEN 'unprocessed' THEN 0
        WHEN 'pending' THEN 1
        WHEN 'investigating' THEN 2
        WHEN 'resolved' THEN 3
        WHEN 'closed' THEN 4
      END
    `
    const incomingStatusRank = sql`
      CASE ${processingStatus}
        WHEN 'unprocessed' THEN 0
        WHEN 'pending' THEN 1
        WHEN 'investigating' THEN 2
        WHEN 'resolved' THEN 3
        WHEN 'closed' THEN 4
      END
    `
    const updated = this.db
      .update(diagnosticReportTable)
      .set({
        processingStatus: sql`
          CASE
            WHEN ${diagnosticReportTable.processingStatus} IS NULL OR ${incomingStatusRank} >= ${currentStatusRank}
            THEN ${processingStatus}
            ELSE ${diagnosticReportTable.processingStatus}
          END
        `,
        lastCheckedAt: Date.now()
      })
      .where(eq(diagnosticReportTable.reportId, reportId))
      .returning()
      .get()
    if (updated) notifyDataApiDataChange([{ endpoint: '/diagnostic-reports', kind: 'projection' }])
  }

  list(page: number, limit: number) {
    const rows = this.db
      .select()
      .from(diagnosticReportTable)
      .orderBy(desc(diagnosticReportTable.submittedAt), desc(diagnosticReportTable.reportId))
      .limit(limit)
      .offset((page - 1) * limit)
      .all()
    const items: DiagnosticReportEntity[] = rows.map((row) => ({
      reportId: row.reportId,
      submittedAt: row.submittedAt,
      processingStatus: row.processingStatus,
      lastCheckedAt: row.lastCheckedAt
    }))
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(diagnosticReportTable)
      .all()
    return { items, page, total: count }
  }
}

export const diagnosticReportService = new DiagnosticReportService()
