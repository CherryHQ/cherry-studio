import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { planKnowledgeItemSource } from '../sourcePlanning'

function createBase(fileProcessorId: string | null = 'doc2x'): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
    dimensions: 3,
    embeddingModelId: 'provider::embed',
    rerankModelId: null,
    fileProcessorId,
    status: 'completed',
    error: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    threshold: undefined,
    documentCount: 10,
    searchMode: 'vector',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createFileItem(source: string): KnowledgeItemOf<'file'> {
  return {
    id: 'file-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'file',
    data: { source, relativePath: source.split('/').pop() ?? source },
    status: 'processing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('planKnowledgeItemSource', () => {
  it.each(['pdf', 'doc', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])(
    'routes supported document .%s files to file processing when a processor is configured',
    (ext) => {
      expect(planKnowledgeItemSource(createBase(), createFileItem(`/docs/source.${ext}`))).toEqual({
        kind: 'needsFileProcessing'
      })
    }
  )

  it('indexes supported documents directly when no file processor is configured', () => {
    expect(planKnowledgeItemSource(createBase(null), createFileItem('/docs/source.pdf'))).toEqual({
      kind: 'index-documents'
    })
  })
})
