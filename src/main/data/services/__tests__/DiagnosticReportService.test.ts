import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { diagnosticReportTable } from '@data/db/schemas/diagnosticReport'
import { diagnosticReportService } from '@data/services/DiagnosticReportService'

describe('DiagnosticReportService', () => {
  const dbh = setupTestDatabase()

  it('keeps the original submission and pages newest reports with deterministic ties', () => {
    for (let index = 0; index < 21; index++) {
      diagnosticReportService.record({
        reportId: `report-${String(index).padStart(2, '0')}`,
        submittedAt: index === 20 ? 19 : index,
        processingStatus: 'pending',
        lastCheckedAt: null
      })
    }
    diagnosticReportService.record({
      reportId: 'report-20',
      submittedAt: 999,
      processingStatus: 'closed',
      lastCheckedAt: 999
    })

    const first = diagnosticReportService.list(1, 20)
    const second = diagnosticReportService.list(2, 20)
    expect(first.total).toBe(21)
    expect(first.items.map((item) => item.reportId).slice(0, 3)).toEqual(['report-20', 'report-19', 'report-18'])
    expect(second.items.map((item) => item.reportId)).toEqual(['report-00'])
    expect(dbh.db.select().from(diagnosticReportTable).all()).toHaveLength(21)
    expect(first.items[0]).toMatchObject({ submittedAt: 19, processingStatus: 'pending', lastCheckedAt: null })
  })

  it('updates only the matching cached status after a successful lookup', () => {
    diagnosticReportService.record({ reportId: 'known', submittedAt: 1, processingStatus: null, lastCheckedAt: null })
    diagnosticReportService.updateStatus('unknown', 'closed')
    diagnosticReportService.updateStatus('known', 'investigating')

    const { items } = diagnosticReportService.list(1, 20)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ reportId: 'known', submittedAt: 1, processingStatus: 'investigating' })
    expect(items[0].lastCheckedAt).toEqual(expect.any(Number))
  })

  it('does not let a stale status lookup move history backwards', () => {
    diagnosticReportService.record({
      reportId: 'monotonic',
      submittedAt: 1,
      processingStatus: 'resolved',
      lastCheckedAt: 1
    })

    diagnosticReportService.updateStatus('monotonic', 'pending')

    const [afterStaleRefresh] = diagnosticReportService.list(1, 20).items
    expect(afterStaleRefresh).toMatchObject({ reportId: 'monotonic', processingStatus: 'resolved' })
    expect(afterStaleRefresh.lastCheckedAt).toBeGreaterThan(1)

    diagnosticReportService.updateStatus('monotonic', 'closed')
    expect(diagnosticReportService.list(1, 20).items[0].processingStatus).toBe('closed')
  })

  it('rejects a processing status outside the shared five-state contract', () => {
    expect(() =>
      dbh.sqlite
        .prepare('INSERT INTO diagnostic_report (report_id, submitted_at, processing_status) VALUES (?, ?, ?)')
        .run('invalid-status', 1, 'complete')
    ).toThrow(/CHECK constraint failed: diagnostic_report_processing_status_check/)
  })
})
