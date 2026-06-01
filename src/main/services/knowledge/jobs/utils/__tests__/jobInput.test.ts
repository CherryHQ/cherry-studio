import { describe, expect, it } from 'vitest'

import { narrowKnowledgeJobInput } from '../jobInput'

describe('narrowKnowledgeJobInput', () => {
  it('accepts item job snapshots', () => {
    expect(
      narrowKnowledgeJobInput({
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null }
      })
    ).toEqual({
      type: 'knowledge.index-documents',
      input: {
        baseId: 'kb-1',
        itemId: 'note-1',
        parentJobId: null
      }
    })
  })

  it('preserves index-documents payload fields', () => {
    expect(
      narrowKnowledgeJobInput({
        type: 'knowledge.index-documents',
        input: {
          baseId: 'kb-1',
          itemId: 'file-1',
          parentJobId: 'reindex-job',
          processedFileEntryId: '019606a0-0000-7000-8000-000000000001'
        }
      })
    ).toEqual({
      type: 'knowledge.index-documents',
      input: {
        baseId: 'kb-1',
        itemId: 'file-1',
        parentJobId: 'reindex-job',
        processedFileEntryId: '019606a0-0000-7000-8000-000000000001'
      }
    })
  })

  it('accepts file-processing check job snapshots', () => {
    expect(
      narrowKnowledgeJobInput({
        type: 'knowledge.check-file-processing-result',
        input: {
          baseId: 'kb-1',
          itemId: 'file-1',
          fileProcessingJobId: 'fp-job-1',
          sourceFileEntryId: '019606a0-0000-7000-8000-000000000001',
          pollRound: 2,
          firstScheduledAt: 1779811200000,
          parentJobId: 'reindex-job'
        }
      })
    ).toEqual({
      type: 'knowledge.check-file-processing-result',
      input: {
        baseId: 'kb-1',
        itemId: 'file-1',
        fileProcessingJobId: 'fp-job-1',
        sourceFileEntryId: '019606a0-0000-7000-8000-000000000001',
        pollRound: 2,
        firstScheduledAt: 1779811200000,
        parentJobId: 'reindex-job'
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
    expect(
      narrowKnowledgeJobInput({
        type: 'knowledge.check-file-processing-result',
        input: {
          baseId: 'kb-1',
          itemId: 'file-1',
          sourceFileEntryId: '019606a0-0000-7000-8000-000000000001'
        }
      })
    ).toBeNull()
  })

  it('rejects index-documents snapshots with invalid payload fields', () => {
    expect(
      narrowKnowledgeJobInput({
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'file-1' }
      })
    ).toBeNull()
    expect(
      narrowKnowledgeJobInput({
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'file-1', parentJobId: 1 }
      })
    ).toBeNull()
    expect(
      narrowKnowledgeJobInput({
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'file-1', parentJobId: null, processedFileEntryId: null }
      })
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
