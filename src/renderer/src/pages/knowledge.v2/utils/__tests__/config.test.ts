import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { buildKnowledgeV2RagConfigPatch, createKnowledgeV2RagConfigFormValues } from '..'

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  description: undefined,
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  searchMode: undefined,
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('createKnowledgeV2RagConfigFormValues', () => {
  it('maps a knowledge base into form values with UI defaults', () => {
    const base = createKnowledgeBase({
      fileProcessorId: 'doc2x',
      chunkSize: 512,
      chunkOverlap: 64,
      rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
      documentCount: undefined,
      threshold: undefined,
      searchMode: undefined,
      hybridAlpha: undefined
    })

    expect(createKnowledgeV2RagConfigFormValues(base)).toEqual({
      fileProcessorId: 'doc2x',
      chunkSize: '512',
      chunkOverlap: '64',
      embeddingModelId: 'openai::text-embedding-3-small',
      rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
      dimensions: 1536,
      documentCount: 6,
      threshold: 0,
      searchMode: 'default',
      hybridAlpha: null
    })
  })
})

describe('buildKnowledgeV2RagConfigPatch', () => {
  it('builds a minimal patch for changed RAG config fields', () => {
    const initialValues = createKnowledgeV2RagConfigFormValues(
      createKnowledgeBase({
        fileProcessorId: 'doc2x',
        chunkSize: 512,
        chunkOverlap: 64,
        rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
        documentCount: 6,
        threshold: 0,
        searchMode: 'default'
      })
    )

    const nextValues = {
      ...initialValues,
      fileProcessorId: 'mineru',
      chunkSize: '1024',
      chunkOverlap: '128',
      embeddingModelId: 'voyage::voyage-3-large',
      rerankModelId: null,
      documentCount: 10,
      threshold: 0.35,
      searchMode: 'hybrid' as const,
      hybridAlpha: 0.7
    }

    expect(buildKnowledgeV2RagConfigPatch(initialValues, nextValues)).toEqual({
      fileProcessorId: 'mineru',
      chunkSize: 1024,
      chunkOverlap: 128,
      embeddingModelId: 'voyage::voyage-3-large',
      rerankModelId: null,
      documentCount: 10,
      threshold: 0.35,
      searchMode: 'hybrid',
      hybridAlpha: 0.7
    })
  })

  it('only emits numeric chunk patches and keeps hybrid alpha clearing behavior', () => {
    const initialValues = createKnowledgeV2RagConfigFormValues(
      createKnowledgeBase({
        chunkSize: 512,
        chunkOverlap: 64,
        searchMode: 'hybrid',
        hybridAlpha: 0.6
      })
    )

    const nextValues = {
      ...initialValues,
      chunkSize: '768',
      searchMode: 'default' as const,
      hybridAlpha: 0.6
    }

    expect(buildKnowledgeV2RagConfigPatch(initialValues, nextValues)).toEqual({
      chunkSize: 768,
      searchMode: 'default',
      hybridAlpha: null
    })
  })

  it('does not force display defaults into the patch when the user did not change them', () => {
    const initialValues = createKnowledgeV2RagConfigFormValues(
      createKnowledgeBase({
        documentCount: undefined,
        threshold: undefined,
        searchMode: undefined,
        hybridAlpha: undefined
      })
    )

    expect(buildKnowledgeV2RagConfigPatch(initialValues, initialValues)).toEqual({
      hybridAlpha: null
    })
  })
})
