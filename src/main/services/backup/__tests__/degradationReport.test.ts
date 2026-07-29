import { describe, expect, it } from 'vitest'

import { compactDegradationsForJournal, presentDegradations, presentJournalDegradations } from '../degradationReport'

describe('backup degradation presentation', () => {
  it('preserves totals while bounding and filtering resource path samples', () => {
    const changed = Array.from({ length: 500 }, (_, index) => ({
      kind: 'resource:note-root',
      reason: 'changed-after-snapshot',
      livePath: `Data/Notes/n-${index}`
    }))
    const unavailable = Array.from({ length: 300 }, (_, index) => ({
      kind: 'resource:file-blob',
      reason: `future-unavailable-reason-${index}`,
      livePath: index === 0 ? '/Users/private/file' : `Data/Files/f-${index}`
    }))

    const compacted = compactDegradationsForJournal([...changed, ...unavailable])

    expect(compacted).toEqual([
      { kind: 'report:resource-changed', reason: 'count:500' },
      { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/n-0' },
      { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/n-1' },
      { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/n-2' },
      { kind: 'report:resource-unavailable', reason: 'count:300' },
      { kind: 'report-sample:resource-unavailable', reason: 'sample', livePath: 'Data/Files/f-1' },
      { kind: 'report-sample:resource-unavailable', reason: 'sample', livePath: 'Data/Files/f-2' },
      { kind: 'report-sample:resource-unavailable', reason: 'sample', livePath: 'Data/Files/f-3' }
    ])
    expect(presentJournalDegradations(compacted)).toEqual([
      {
        code: 'resource-changed',
        count: 500,
        paths: ['Data/Notes/n-0', 'Data/Notes/n-1', 'Data/Notes/n-2']
      },
      {
        code: 'resource-unavailable',
        count: 300,
        paths: ['Data/Files/f-1', 'Data/Files/f-2', 'Data/Files/f-3']
      }
    ])
    expect(JSON.stringify(compacted)).not.toContain('/Users/private')
  })

  it('keeps old journal lines and materialization row counts readable', () => {
    expect(
      presentDegradations([
        {
          kind: 'resource:knowledge-base',
          reason: 'absent at snapshot time',
          livePath: 'Data/KnowledgeBase/base-1'
        },
        { kind: 'restore-db:note', reason: 'path-unportable (2 rows)', livePath: 'Data/Notes/forged' }
      ])
    ).toEqual([
      { code: 'resource-unavailable', count: 1, paths: ['Data/KnowledgeBase/base-1'] },
      { code: 'path-unportable', count: 2 }
    ])
  })

  it('groups capture omissions by reason and exposes at most three safe relative samples', () => {
    const degradations = [
      ...Array.from({ length: 4 }, (_, index) => ({
        kind: 'resource-entry:note-root',
        reason: 'external-reference',
        livePath: `Data/Notes/external-${index}`
      })),
      {
        kind: 'resource-entry:note-root',
        reason: 'dangling-reference',
        livePath: 'Data/Notes/dangling'
      },
      {
        kind: 'resource-entry:note-root',
        reason: 'cyclic-reference',
        livePath: 'Data/Notes/cycle'
      },
      {
        kind: 'resource-entry:note-root',
        reason: 'unclassified-reference',
        livePath: '/Users/private/not-safe'
      }
    ]

    expect(presentDegradations(degradations)).toEqual([
      {
        code: 'external-reference',
        count: 4,
        paths: ['Data/Notes/external-0', 'Data/Notes/external-1', 'Data/Notes/external-2']
      },
      { code: 'dangling-reference', count: 1, paths: ['Data/Notes/dangling'] },
      { code: 'cyclic-reference', count: 1, paths: ['Data/Notes/cycle'] },
      { code: 'unclassified-reference', count: 1 }
    ])
  })
})
