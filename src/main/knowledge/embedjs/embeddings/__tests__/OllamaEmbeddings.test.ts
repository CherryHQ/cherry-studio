import { OllamaEmbeddings } from '@cherrystudio/embedjs-ollama'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn()

  return { fetchMock }
})

describe('OllamaEmbeddings', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns configured dimensions without probing Ollama', async () => {
    const embeddings = new OllamaEmbeddings({
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
      dimensions: 768
    })

    await expect(embeddings.getDimensions()).resolves.toBe(768)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the current /api/embed response shape for dimension probing', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: [[0.1, 0.2, 0.3, 0.4]]
        })
      )
    )

    const embeddings = new OllamaEmbeddings({
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434'
    })

    await expect(embeddings.getDimensions()).resolves.toBe(4)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'nomic-embed-text',
          input: 'sample'
        })
      })
    )
  })

  it('falls back to legacy /api/embeddings when /api/embed fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: [1, 2, 3] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: [4, 5, 6] })))

    const embeddings = new OllamaEmbeddings({
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434'
    })

    await expect(embeddings.embedDocuments(['first', 'second'])).resolves.toEqual([
      [1, 2, 3],
      [4, 5, 6]
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:11434/api/embed', expect.anything())
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: 'first',
          keep_alive: undefined,
          options: undefined
        })
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: 'second',
          keep_alive: undefined,
          options: undefined
        })
      })
    )
  })
})
