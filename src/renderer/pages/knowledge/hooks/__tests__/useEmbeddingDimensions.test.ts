import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEmbeddingDimensions } from '../useEmbeddingDimensions'

// embedMany goes through ipcApi.request('ai.embedding.embed_many', …) now (Main IPC).
const { mockEmbedMany } = vi.hoisted(() => ({ mockEmbedMany: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => mockEmbedMany(input) }
}))

describe('useEmbeddingDimensions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbedMany.mockResolvedValue({ embeddings: [new Array(1536).fill(0)] })
  })

  it('fetches embedding dimensions for the provided UniqueModelId', async () => {
    const { result } = renderHook(() => useEmbeddingDimensions())
    let dimensions = 0

    await act(async () => {
      dimensions = await result.current.fetchDimensions('openai::text-embedding-3-small')
    })

    expect(dimensions).toBe(1536)
    expect(mockEmbedMany).toHaveBeenCalledWith({
      uniqueModelId: 'openai::text-embedding-3-small',
      values: ['test']
    })
    expect(result.current.isFetchingDimensions).toBe(false)
  })

  it('returns builtin local embedding dimensions without probing the model', async () => {
    const { result } = renderHook(() => useEmbeddingDimensions())

    let qwen = 0
    let harrier = 0
    await act(async () => {
      qwen = await result.current.fetchDimensions('local-embedding::qwen3-embedding-0.6b')
      harrier = await result.current.fetchDimensions('local-embedding::harrier-oss-v1-270m')
    })

    expect(qwen).toBe(1024)
    expect(harrier).toBe(640)
    expect(mockEmbedMany).not.toHaveBeenCalled()
    expect(result.current.isFetchingDimensions).toBe(false)
  })

  it('toggles loading while the request is pending', async () => {
    let resolveRequest: (value: { embeddings: number[][] }) => void = () => {}
    mockEmbedMany.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )
    const { result } = renderHook(() => useEmbeddingDimensions())

    let fetchPromise: Promise<number>
    act(() => {
      fetchPromise = result.current.fetchDimensions('openai::text-embedding-3-small')
    })

    expect(result.current.isFetchingDimensions).toBe(true)

    await act(async () => {
      resolveRequest({ embeddings: [new Array(3072).fill(0)] })
      await fetchPromise
    })

    expect(result.current.isFetchingDimensions).toBe(false)
  })

  it('rejects invalid UniqueModelId values before calling the API', async () => {
    const { result } = renderHook(() => useEmbeddingDimensions())

    await act(async () => {
      await expect(result.current.fetchDimensions('text-embedding-3-small')).rejects.toThrow(
        'Must be a valid UniqueModelId'
      )
    })
    expect(mockEmbedMany).not.toHaveBeenCalled()
  })

  it('rejects empty embedding vectors', async () => {
    mockEmbedMany.mockResolvedValueOnce({ embeddings: [[]] })
    const { result } = renderHook(() => useEmbeddingDimensions())

    await act(async () => {
      await expect(result.current.fetchDimensions('openai::text-embedding-3-small')).rejects.toThrow(
        'Invalid embedding dimensions'
      )
    })
  })

  it('propagates API failures', async () => {
    const error = new Error('API failed')
    mockEmbedMany.mockRejectedValueOnce(error)
    const { result } = renderHook(() => useEmbeddingDimensions())

    await act(async () => {
      await expect(result.current.fetchDimensions('openai::text-embedding-3-small')).rejects.toBe(error)
    })
  })
})
