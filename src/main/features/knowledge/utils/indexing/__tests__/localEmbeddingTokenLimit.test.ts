import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPathMock: vi.fn(),
  currentModelSourceMock: vi.fn(),
  fromPretrainedMock: vi.fn(),
  tokenizerEncodeMock: vi.fn(),
  env: {}
}))

vi.mock('@application', () => ({
  application: {
    getPath: mocks.getPathMock
  }
}))

vi.mock('@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime', () => ({
  currentModelSource: mocks.currentModelSourceMock
}))

vi.mock('@huggingface/transformers', () => ({
  env: mocks.env,
  AutoTokenizer: {
    from_pretrained: mocks.fromPretrainedMock
  }
}))

const { refineLocalEmbeddingChunks } = await import('../localEmbeddingTokenLimit')
const { LOCAL_MODELS } = await import('@main/ai/inference/localModelCatalog')

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
  it('loads the local embedding tokenizer and enforces the effective token cap', async () => {
    mocks.getPathMock.mockReturnValue('/models/embedding')
    mocks.currentModelSourceMock.mockReturnValue({
      remoteHost: 'https://www.modelscope.cn',
      remotePathTemplate: 'models/{model}/resolve/{revision}',
      revision: 'master'
    })
    mocks.tokenizerEncodeMock.mockImplementation((text: string) =>
      Array.from({ length: text.length }, (_, index) => index)
    )
    mocks.fromPretrainedMock.mockResolvedValue({ encode: mocks.tokenizerEncodeMock })

    const refined = await refineLocalEmbeddingChunks(createBase(), {
      contentText: 'abcdefghij',
      chunks: [{ unitIndex: 0, charStart: 0, charEnd: 10, text: 'abcdefghij' }]
    })

    expect(mocks.env).toMatchObject({
      allowRemoteModels: true,
      cacheDir: '/models/embedding',
      remoteHost: 'https://www.modelscope.cn',
      remotePathTemplate: 'models/{model}/resolve/{revision}'
    })
    expect(mocks.fromPretrainedMock).toHaveBeenCalledWith(LOCAL_MODELS.embedding.repo, { revision: 'master' })
    expect(refined.chunks.length).toBeGreaterThan(1)
    for (const chunk of refined.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4)
      expect(refined.contentText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
  })
})
