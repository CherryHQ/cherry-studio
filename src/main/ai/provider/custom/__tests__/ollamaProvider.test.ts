import { afterEach, describe, expect, it, vi } from 'vitest'

const CreateOllamaFn = vi.fn()
const TransportCtor = vi.fn()

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: (settings: unknown) => {
    CreateOllamaFn(settings)
    return { languageModel: vi.fn(), embeddingModel: vi.fn() }
  }
}))

vi.mock('../ollama/ollamaTransport', () => ({
  createOllamaTransport: (settings: { baseURL: string; headers?: Record<string, string> }) => {
    TransportCtor(settings)
    return { submit: vi.fn() }
  }
}))

import { createOllamaWithImageModel } from '../ollama/ollamaProvider'

describe('createOllamaWithImageModel', () => {
  afterEach(() => {
    CreateOllamaFn.mockReset()
    TransportCtor.mockReset()
  })

  it('preserves the base ollama-ai-provider-v2 chat/embedding models', () => {
    const provider = createOllamaWithImageModel({ baseURL: 'http://localhost:11434/api' })
    expect(CreateOllamaFn).toHaveBeenCalledWith({ baseURL: 'http://localhost:11434/api' })
    expect(typeof provider.languageModel).toBe('function')
    expect(typeof provider.embeddingModel).toBe('function')
  })

  it('imageModel returns an ImageGenerationModel with provider="ollama"', () => {
    const provider = createOllamaWithImageModel({ baseURL: 'http://localhost:11434/api' })
    expect(provider.imageModel('x/z-image-turbo').provider).toBe('ollama')
  })

  it('image transport uses the configured baseURL and headers', () => {
    createOllamaWithImageModel({ baseURL: 'http://localhost:11434/api', headers: { Authorization: 'Bearer t' } })
    expect(TransportCtor).toHaveBeenCalledWith({
      baseURL: 'http://localhost:11434/api',
      headers: { Authorization: 'Bearer t' }
    })
  })

  it('image transport falls back to the default local baseURL when omitted', () => {
    createOllamaWithImageModel({})
    expect(TransportCtor).toHaveBeenCalledWith({ baseURL: 'http://127.0.0.1:11434/api', headers: undefined })
  })

  it('forwards the caller-injected fetch (e.g. the proxy-aware customFetch) to the transport', () => {
    const injectedFetch = vi.fn()
    createOllamaWithImageModel({ baseURL: 'http://localhost:11434/api', fetch: injectedFetch })
    expect(TransportCtor).toHaveBeenCalledWith({
      baseURL: 'http://localhost:11434/api',
      headers: undefined,
      fetch: injectedFetch
    })
  })
})
