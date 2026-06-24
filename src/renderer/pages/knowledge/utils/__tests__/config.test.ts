import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { buildKnowledgeRagConfigPatch, createKnowledgeRagConfigFormValues } from '..'

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  groupId: null,
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
  threshold: undefined,
  documentCount: undefined,
  status: 'completed',
  error: null,
  searchMode: 'hybrid',
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
      searchMode: 'hybrid'
    })

    expect(createKnowledgeRagConfigFormValues(base)).toEqual({
      fileProcessorId: 'doc2x',
      chunkSize: '512',
      chunkOverlap: '64',
      chunkStrategy: 'structured',
      chunkSeparator: '\\n\\n',
      embeddingModelId: 'openai::text-embedding-3-small',
      rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
      documentCount: 6,
      threshold: 0,
      searchMode: 'hybrid',
      hybridAlpha: null
    })
  })
})

describe('buildKnowledgeV2RagConfigPatch', () => {
  it('builds a minimal patch for changed RAG config fields', () => {
    const initialValues = createKnowledgeRagConfigFormValues(
      createKnowledgeBase({
        fileProcessorId: 'doc2x',
        chunkSize: 512,
        chunkOverlap: 64,
        rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
        documentCount: 6,
        threshold: 0,
        searchMode: 'vector'
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
      searchMode: 'hybrid' as const
    }

    expect(buildKnowledgeRagConfigPatch(initialValues, nextValues)).toEqual({
      fileProcessorId: 'mineru',
      chunkSize: 1024,
      chunkOverlap: 128,
      rerankModelId: null,
      documentCount: 10,
      threshold: 0.35,
      searchMode: 'hybrid'
    })
  })

  it('builds null clears for nullable RAG config fields', () => {
    const initialValues = createKnowledgeRagConfigFormValues(
      createKnowledgeBase({
        fileProcessorId: 'doc2x',
        rerankModelId: 'jina::jina-reranker-v2-base-multilingual'
      })
    )

    expect(
      buildKnowledgeRagConfigPatch(initialValues, {
        ...initialValues,
        fileProcessorId: null,
        rerankModelId: null
      })
    ).toEqual({
      fileProcessorId: null,
      rerankModelId: null
    })
  })

  it('includes the search mode change without unrelated fields', () => {
    const initialValues = createKnowledgeRagConfigFormValues(
      createKnowledgeBase({
        chunkSize: 512,
        chunkOverlap: 64,
        searchMode: 'hybrid'
      })
    )

    const nextValues = {
      ...initialValues,
      chunkSize: '768',
      searchMode: 'vector' as const
    }

    expect(buildKnowledgeRagConfigPatch(initialValues, nextValues)).toEqual({
      chunkSize: 768,
      searchMode: 'vector'
    })
  })

  it('does not force display defaults into the patch when the user did not change them', () => {
    const initialValues = createKnowledgeRagConfigFormValues(
      createKnowledgeBase({
        documentCount: undefined,
        threshold: undefined,
        searchMode: 'hybrid'
      })
    )

    expect(buildKnowledgeRagConfigPatch(initialValues, initialValues)).toEqual({})
  })
})
