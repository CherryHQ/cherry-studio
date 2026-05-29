import { describe, expect, it } from 'vitest'

import { narrowKnowledgeJobInput } from '../jobInput'

describe('narrowKnowledgeJobInput', () => {
  it('accepts item job snapshots', () => {
    expect(
      narrowKnowledgeJobInput({ type: 'knowledge.index-documents', input: { baseId: 'kb-1', itemId: 'note-1' } })
    ).toEqual({
      type: 'knowledge.index-documents',
      input: {
        baseId: 'kb-1',
        itemId: 'note-1'
      }
    })
  })

  it('accepts subtree job snapshots', () => {
    expect(
      narrowKnowledgeJobInput({ type: 'knowledge.reindex-subtree', input: { baseId: 'kb-1', rootItemIds: ['dir-1'] } })
    ).toEqual({
      type: 'knowledge.reindex-subtree',
      input: {
        baseId: 'kb-1',
        rootItemIds: ['dir-1']
      }
    })
  })

  it('rejects snapshots whose type and input shape disagree', () => {
    expect(
      narrowKnowledgeJobInput({ type: 'knowledge.index-documents', input: { baseId: 'kb-1', rootItemIds: ['dir-1'] } })
    ).toBeNull()
    expect(
      narrowKnowledgeJobInput({ type: 'knowledge.delete-subtree', input: { baseId: 'kb-1', itemId: 'note-1' } })
    ).toBeNull()
  })

  it('rejects non-knowledge job snapshots', () => {
    expect(narrowKnowledgeJobInput({ type: 'other.job', input: { baseId: 'kb-1', itemId: 'note-1' } })).toBeNull()
    expect(
      narrowKnowledgeJobInput({ type: 'knowledge.reindex-subtree', input: { baseId: 'kb-1', rootItemIds: [1] } })
    ).toBeNull()
    expect(narrowKnowledgeJobInput({ type: 'knowledge.prepare-root', input: null })).toBeNull()
  })
})
