import { describe, expect, it } from 'vitest'

import {
  compactDegradationsForJournal,
  manifestDegradationsForJournal,
  presentDegradations,
  presentJournalDegradations
} from '../degradationReport'

describe('Lite degradation presentation', () => {
  it('converts materialization detail into bounded closed archive aggregates', () => {
    const report = presentDegradations([
      { kind: 'portable-db:file_entry', reason: 'external-file-dropped (3 rows)' },
      { kind: 'portable-db:agent_workspace', reason: 'external-workspace-reset (4 rows)' }
    ])

    expect(report).toEqual([
      { code: 'external-file-dropped', count: 3 },
      { code: 'unknown', count: 4 }
    ])
    expect(JSON.stringify(report)).not.toContain('file_entry')
  })

  it('retains export and restore origins internally while presenting one closed total after relaunch', () => {
    const journal = compactDegradationsForJournal([
      ...manifestDegradationsForJournal([{ code: 'external-file-dropped', count: 2 }]),
      { kind: 'restore-db:file_entry', reason: 'external-file-dropped (1 row)' },
      { kind: 'restore-db:agent_workspace', reason: 'external-workspace-reset (4 rows)' }
    ])

    expect(journal).toEqual([
      { kind: 'report:export-db:external-file-dropped', reason: 'count:2' },
      { kind: 'report:restore-db:external-file-dropped', reason: 'count:1' },
      { kind: 'report:restore-db:unknown', reason: 'count:4' }
    ])
    expect(presentJournalDegradations(journal)).toEqual([
      { code: 'external-file-dropped', count: 3 },
      { code: 'unknown', count: 4 }
    ])
  })
})
