import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { buildKnowledgeRagConfigPatch, createKnowledgeRagConfigFormValues } from '../rag'

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
      documentCount: undefined
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
      threshold: 0
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
        threshold: 0.2
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
      threshold: 0.4
    }

    expect(buildKnowledgeRagConfigPatch(initialValues, nextValues)).toEqual({
      fileProcessorId: 'mineru',
      chunkSize: 1024,
      chunkOverlap: 128,
      rerankModelId: null,
      documentCount: 10,
      threshold: 0.4
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

  it('does not force display defaults into the patch when the user did not change them', () => {
    const initialValues = createKnowledgeRagConfigFormValues(
      createKnowledgeBase({
        documentCount: undefined
      })
    )

    expect(buildKnowledgeRagConfigPatch(initialValues, initialValues)).toEqual({})
  })
})
