import { describe, expect, it, vi } from 'vitest'

import type { KnowledgeBase } from '@shared/data/types/knowledge'

const mocks = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  currentModelDirMock: vi.fn(),
  countTokensMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: mocks.appGetMock }
}))

vi.mock('@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime', () => ({
  currentModelDir: mocks.currentModelDirMock
}))

const { refineLocalEmbeddingChunks } = await import('../localEmbeddingTokenLimit')
const { LOCAL_MODELS } = await import('@main/ai/inference/localModelCatalog')

/** The ModelScope cache layout: transformers.js nests the non-`main` revision. */
const MODEL_DIR = '/models/qwen3-embedding/onnx-community/Qwen3-Embedding-0.6B-ONNX/master'
const KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: KNOWLEDGE_BASE_ID,
    name: 'KB',
    groupId: null,
    dimensions: 1024,
    embeddingModelId: 'local-embedding::qwen3-embedding-0.6b',
    status: 'completed',
    error: null,
    chunkSize: 4,
    chunkOverlap: 1,
    chunkStrategy: 'structured',
    chunkSeparator: '\\n\\n',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides
  }
}

describe('refineLocalEmbeddingChunks', () => {
  it('counts tokens via the inference worker (never imports @huggingface/transformers on the main process) and enforces the effective token cap', async () => {
    mocks.currentModelDirMock.mockReturnValue(MODEL_DIR)
    mocks.countTokensMock.mockImplementation((texts: string[]) => Promise.resolve(texts.map((text) => text.length)))
    mocks.appGetMock.mockImplementation((name: string) => {
      if (name === 'EmbeddingInferenceService') {
        return { countTokens: mocks.countTokensMock }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })

    const refined = await refineLocalEmbeddingChunks(createBase(), {
      contentText: 'abcdefghij',
      chunks: [{ unitIndex: 0, charStart: 0, charEnd: 10, text: 'abcdefghij' }]
    })

    expect(mocks.countTokensMock).toHaveBeenCalledWith(
      expect.any(Array),
      MODEL_DIR,
      LOCAL_MODELS.embedding.dtype,
      undefined
    )
    expect(refined.chunks.length).toBeGreaterThan(1)
    for (const chunk of refined.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4)
      expect(refined.contentText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
  })

  it('threads the caller-provided AbortSignal through to the worker call', async () => {
    mocks.currentModelDirMock.mockReturnValue(MODEL_DIR)
    mocks.countTokensMock.mockImplementation((texts: string[]) => Promise.resolve(texts.map((text) => text.length)))
    mocks.appGetMock.mockImplementation((name: string) => {
      if (name === 'EmbeddingInferenceService') {
        return { countTokens: mocks.countTokensMock }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })

    const controller = new AbortController()
    await refineLocalEmbeddingChunks(
      createBase(),
      { contentText: 'abc', chunks: [{ unitIndex: 0, charStart: 0, charEnd: 3, text: 'abc' }] },
      controller.signal
    )

    expect(mocks.countTokensMock).toHaveBeenCalledWith(
      expect.any(Array),
      MODEL_DIR,
      expect.any(String),
      controller.signal
    )
  })
})
