import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheGetSharedMock, cacheSetSharedMock } = vi.hoisted(() => ({
  cacheGetSharedMock: vi.fn(),
  cacheSetSharedMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn(() => ({ getShared: cacheGetSharedMock, setShared: cacheSetSharedMock }))
  }
}))

import { lowerOllamaNumCtxCap } from '../ollamaRequestNumCtx'

describe('lowerOllamaNumCtxCap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes the lowered cap for the failed model while preserving other model caps', () => {
    cacheGetSharedMock.mockReturnValue({ 'ollama::a': 32_768 })

    lowerOllamaNumCtxCap('ollama::b', 16_384)

    expect(cacheSetSharedMock).toHaveBeenCalledWith('ollama.num_ctx_caps', {
      'ollama::a': 32_768,
      'ollama::b': 16_384
    })
  })

  it('never raises an already-lowered cap from a stale retry', () => {
    cacheGetSharedMock.mockReturnValue({ 'ollama::a': 16_384 })

    lowerOllamaNumCtxCap('ollama::a', 32_768)

    expect(cacheSetSharedMock).not.toHaveBeenCalled()
  })

  it('writes the first cap for a model with none', () => {
    cacheGetSharedMock.mockReturnValue(undefined)

    lowerOllamaNumCtxCap('ollama::a', 32_768)

    expect(cacheSetSharedMock).toHaveBeenCalledWith('ollama.num_ctx_caps', { 'ollama::a': 32_768 })
  })
})
