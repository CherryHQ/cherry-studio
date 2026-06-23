import type { KnowledgeAddItemInput, KnowledgeItem } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { resolveKnowledgeAddConflicts } from '../addConflicts'

const existingItem = (id: string, partial: Pick<KnowledgeItem, 'type' | 'data'>): KnowledgeItem =>
  ({
    id,
    baseId: '11111111-1111-4111-8111-111111111111',
    groupId: null,
    status: 'completed',
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }) as KnowledgeItem

const fileInput = (source: string): KnowledgeAddItemInput => ({ type: 'file', data: { source, path: source } })
const urlInput = (url: string): KnowledgeAddItemInput => ({ type: 'url', data: { source: url, url } })
const noteInput = (content: string): KnowledgeAddItemInput => ({ type: 'note', data: { source: 'note', content } })

describe('resolveKnowledgeAddConflicts', () => {
  it('reports no conflicts and keeps all inputs when nothing collides', () => {
    const inputs = [fileInput('/a/report.pdf'), urlInput('https://x.com')]
    const existing = [
      existingItem('e1', { type: 'file', data: { source: '/old/other.pdf', relativePath: 'other.pdf' } })
    ]

    const result = resolveKnowledgeAddConflicts(inputs, existing)

    expect(result.conflicts).toEqual([])
    expect(result.conflictingExistingRootIds).toEqual([])
    expect(result.keptInputs).toEqual(inputs)
  })

  it('detects a collision against an existing root and reports the existing display title', () => {
    const inputs = [fileInput('/folderA/report.pdf')]
    const existing = [
      existingItem('e1', { type: 'file', data: { source: '/old/report.pdf', relativePath: 'report.pdf' } })
    ]

    const result = resolveKnowledgeAddConflicts(inputs, existing)

    expect(result.conflicts).toEqual([{ type: 'file', title: 'report.pdf' }])
    expect(result.conflictingExistingRootIds).toEqual(['e1'])
    expect(result.keptInputs).toEqual(inputs)
  })

  it('does not collide across types (file vs note with the same name)', () => {
    const inputs = [fileInput('/a/report')]
    const existing = [existingItem('e1', { type: 'note', data: { source: 'note', content: 'report' } })]

    const result = resolveKnowledgeAddConflicts(inputs, existing)

    expect(result.conflicts).toEqual([])
    expect(result.conflictingExistingRootIds).toEqual([])
  })

  it('keys url detection off the raw url even when the existing snapshot title diverges', () => {
    const inputs = [urlInput('https://x.com')]
    const existing = [
      existingItem('e1', {
        type: 'url',
        data: { source: 'https://x.com', url: 'https://x.com', relativePath: 'Captured Title.md' }
      })
    ]

    const result = resolveKnowledgeAddConflicts(inputs, existing)

    // Detection matched the url; the reported title is the existing item's snapshot display name.
    expect(result.conflicts).toEqual([{ type: 'url', title: 'Captured Title' }])
    expect(result.conflictingExistingRootIds).toEqual(['e1'])
  })

  it('detects an in-batch collision (last wins) and drops the earlier same-name input', () => {
    const first = fileInput('/folderA/report.pdf')
    const second = fileInput('/folderB/report.pdf')
    const inputs = [first, second]

    const result = resolveKnowledgeAddConflicts(inputs, [])

    expect(result.conflicts).toEqual([{ type: 'file', title: 'report.pdf' }])
    expect(result.conflictingExistingRootIds).toEqual([])
    // last wins: only the second same-name input survives
    expect(result.keptInputs).toEqual([second])
  })

  it('dedupes the reported conflicts by type and key', () => {
    const inputs = [fileInput('/folderA/report.pdf'), fileInput('/folderB/report.pdf')]
    const existing = [
      existingItem('e1', { type: 'file', data: { source: '/old/report.pdf', relativePath: 'report.pdf' } })
    ]

    const result = resolveKnowledgeAddConflicts(inputs, existing)

    expect(result.conflicts).toEqual([{ type: 'file', title: 'report.pdf' }])
    expect(result.conflictingExistingRootIds).toEqual(['e1'])
  })

  it('on replace, targets only the existing copy whose deduped relativePath matches the incoming source', () => {
    // Three test.md kept side by side are stored as test.md / test_2.md / test_3.md
    // (deduped relativePath). A new test.md must overwrite ONLY relativePath `test.md`,
    // leaving test_2.md / test_3.md intact — they are distinct, deliberately-kept copies.
    const inputs = [fileInput('/incoming/test.md')]
    const existing = [
      existingItem('e1', { type: 'file', data: { source: '/a/test.md', relativePath: 'test.md' } }),
      existingItem('e2', { type: 'file', data: { source: '/b/test.md', relativePath: 'test_2.md' } }),
      existingItem('e3', { type: 'file', data: { source: '/c/test.md', relativePath: 'test_3.md' } })
    ]

    const result = resolveKnowledgeAddConflicts(inputs, existing)

    expect(result.conflicts).toEqual([{ type: 'file', title: 'test.md' }])
    expect(result.conflictingExistingRootIds).toEqual(['e1'])
  })

  it('never collides blank-content notes (empty detection key) and keeps them all', () => {
    // An empty note has no first line, so its detection key is '' — that is not a
    // real name and must never alias other empty notes into a phantom conflict.
    const inputs = [noteInput(''), noteInput('')]
    const existing = [existingItem('e1', { type: 'note', data: { source: 'note', content: '' } })]

    const result = resolveKnowledgeAddConflicts(inputs, existing)

    expect(result.conflicts).toEqual([])
    expect(result.conflictingExistingRootIds).toEqual([])
    // Both blank notes survive: empty keys never participate in in-batch dedup either.
    expect(result.keptInputs).toEqual(inputs)
  })
})
