import { describe, expect, it } from 'vitest'

import { narrowKnowledgeJobInput } from '../jobInput'

describe('narrowKnowledgeJobInput', () => {
  it.each([
    { type: 'knowledge.copy-sources', execution: { copies: [{ from: 42 }] } },
    { type: 'knowledge.prepare-root', execution: {} },
    { type: 'knowledge.index-documents', execution: {} },
    {
      type: 'knowledge.check-file-processing-result',
      execution: { fileProcessingTaskId: null, processedRelativePath: 42 }
    }
  ])('reads $type ownership independently of execution fields', ({ type, execution }) => {
    expect(narrowKnowledgeJobInput({ type, input: { baseId: 'kb-1', itemId: 'file-1', ...execution } })).toEqual({
      type,
      input: { baseId: 'kb-1', itemId: 'file-1' }
    })
  })

  it.each(['knowledge.delete-subtree', 'knowledge.reindex-subtree'])('reads all roots for %s', (type) => {
    expect(narrowKnowledgeJobInput({ type, input: { baseId: 'kb-1', rootItemIds: ['dir-1', 'file-1'] } })).toEqual({
      type,
      input: { baseId: 'kb-1', rootItemIds: ['dir-1', 'file-1'] }
    })
  })

  it.each([
    { type: 'knowledge.index-documents', input: { baseId: 'kb-1', rootItemIds: ['dir-1'] } },
    { type: 'knowledge.delete-subtree', input: { baseId: 'kb-1', itemId: 'note-1' } },
    { type: 'knowledge.reindex-subtree', input: { baseId: 'kb-1', rootItemIds: [1] } },
    { type: 'knowledge.prepare-root', input: null },
    { type: 'knowledge.copy-sources', input: { baseId: 'kb-1', itemId: 42 } },
    { type: 'other.job', input: { baseId: 'kb-1', itemId: 'note-1' } }
  ])('rejects missing, invalid or unrecognized ownership: %j', (snapshot) => {
    expect(narrowKnowledgeJobInput(snapshot)).toBeNull()
  })
})
