import os from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { isLocalOllamaApiHost, resolveOllamaRequestNumCtx } from '../ollamaRequestNumCtx'

describe('isLocalOllamaApiHost', () => {
  it('treats loopback and empty hosts as local', () => {
    expect(isLocalOllamaApiHost('')).toBe(true)
    expect(isLocalOllamaApiHost('http://127.0.0.1:11434')).toBe(true)
    expect(isLocalOllamaApiHost('http://localhost:11434')).toBe(true)
  })

  it('treats remote hosts as non-local', () => {
    expect(isLocalOllamaApiHost('http://ollama.lan:11434')).toBe(false)
    expect(isLocalOllamaApiHost('https://192.168.1.10:11434')).toBe(false)
    expect(isLocalOllamaApiHost('http://127.evil.example:11434')).toBe(false)
  })
})

describe('resolveOllamaRequestNumCtx', () => {
  const model = {
    id: 'ollama::qwen3',
    contextWindow: 131_072
  } as const

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('caps by local RAM for a loopback Ollama endpoint', () => {
    const freeMemoryBytes = 8_000_000_000
    const totalMemoryBytes = 16_000_000_000
    vi.spyOn(os, 'freemem').mockReturnValue(freeMemoryBytes)
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMemoryBytes)

    const provider = {
      defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT,
      endpointConfigs: {
        [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: 'http://127.0.0.1:11434' }
      }
    } as Provider

    const resolution = resolveOllamaRequestNumCtx(model as never, provider)
    expect(resolution?.freeMemoryBytes).toBe(freeMemoryBytes)
    expect(resolution?.totalMemoryBytes).toBe(totalMemoryBytes)
    expect(resolution?.numCtx).toBeLessThan(131_072)
  })

  it('does not cap by Cherry client RAM for a remote Ollama endpoint', () => {
    const provider = {
      defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT,
      endpointConfigs: {
        [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: 'http://nas.local:11434' }
      }
    } as Provider

    const resolution = resolveOllamaRequestNumCtx(model as never, provider)
    expect(resolution?.freeMemoryBytes).toBe(0)
    expect(resolution?.totalMemoryBytes).toBe(0)
    expect(resolution?.numCtx).toBe(131_072)
  })

  it('classifies local vs remote using the same endpoint as the active request', () => {
    const freeMemoryBytes = 8_000_000_000
    const totalMemoryBytes = 16_000_000_000
    vi.spyOn(os, 'freemem').mockReturnValue(freeMemoryBytes)
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMemoryBytes)

    const provider = {
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'http://127.0.0.1:11434' },
        [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: 'http://nas.local:11434' }
      }
    } as Provider

    const loopbackRequest = resolveOllamaRequestNumCtx(model as never, provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(loopbackRequest?.freeMemoryBytes).toBe(freeMemoryBytes)
    expect(loopbackRequest?.numCtx).toBeLessThan(131_072)

    const remoteRequest = resolveOllamaRequestNumCtx(model as never, provider, ENDPOINT_TYPE.OLLAMA_CHAT)
    expect(remoteRequest?.freeMemoryBytes).toBe(0)
    expect(remoteRequest?.numCtx).toBe(131_072)
  })
})
