import { describe, expect, it } from 'vitest'

import {
  enrichOllamaContextAllocationSerializedError,
  isOllamaKvCacheAllocationError,
  resolveOllamaNumCtx,
  roundDownOllamaNumCtx,
  suggestReducedOllamaNumCtx
} from '../ollamaNumCtx'

describe('resolveOllamaNumCtx', () => {
  it('keeps the trained window when memory can support it', () => {
    const numCtx = resolveOllamaNumCtx({
      trainedContextWindow: 131_072,
      freeMemoryBytes: 32 * 1024 ** 3,
      totalMemoryBytes: 64 * 1024 ** 3
    })
    expect(numCtx).toBe(131_072)
  })

  it('caps a 128k trained window on a lower-memory machine', () => {
    const numCtx = resolveOllamaNumCtx({
      trainedContextWindow: 131_072,
      freeMemoryBytes: 8 * 1024 ** 3,
      totalMemoryBytes: 16 * 1024 ** 3
    })
    expect(numCtx).toBeLessThan(131_072)
    expect(numCtx).toBeGreaterThanOrEqual(4_096)
  })

  it('never exceeds the trained context window when applying the minimum floor', () => {
    const numCtx = resolveOllamaNumCtx({
      trainedContextWindow: 2_048,
      freeMemoryBytes: 32 * 1024 ** 3,
      totalMemoryBytes: 64 * 1024 ** 3
    })
    expect(numCtx).toBe(2_048)
  })

  it('applies a session cap from a prior OOM retry', () => {
    const numCtx = resolveOllamaNumCtx({
      trainedContextWindow: 131_072,
      freeMemoryBytes: 32 * 1024 ** 3,
      totalMemoryBytes: 64 * 1024 ** 3,
      sessionCap: 32_768
    })
    expect(numCtx).toBe(32_768)
  })
})

describe('roundDownOllamaNumCtx', () => {
  it('rounds down to the nearest power-of-two floor at least 4096', () => {
    expect(roundDownOllamaNumCtx(90_000)).toBe(65_536)
    expect(roundDownOllamaNumCtx(4_096)).toBe(4_096)
  })
})

describe('suggestReducedOllamaNumCtx', () => {
  it('halves and rounds down for retry', () => {
    expect(suggestReducedOllamaNumCtx(131_072)).toBe(65_536)
    expect(suggestReducedOllamaNumCtx(8_192)).toBe(4_096)
  })
})

describe('isOllamaKvCacheAllocationError', () => {
  it('recognizes KV-cache allocation failures', () => {
    expect(isOllamaKvCacheAllocationError('failed to allocate KV cache')).toBe(true)
    expect(isOllamaKvCacheAllocationError('out of memory allocating kvcache')).toBe(true)
    expect(isOllamaKvCacheAllocationError('cuda out of memory')).toBe(false)
    expect(isOllamaKvCacheAllocationError('HTTP 500 Internal Server Error')).toBe(false)
  })

  it('ignores informational KV-cache mentions without an allocation failure', () => {
    expect(isOllamaKvCacheAllocationError('kv cache memory layout optimized')).toBe(false)
  })
})

describe('enrichOllamaContextAllocationSerializedError', () => {
  it('tags allocation failures with context metadata', () => {
    const serialized: Record<string, unknown> = {
      message: 'model failed: out of memory allocating kv cache'
    }
    enrichOllamaContextAllocationSerializedError(serialized, {
      trainedContextWindow: 131_072,
      effectiveNumCtx: 65_536
    })
    expect(serialized.i18nKey).toBe('ollama_context_memory')
    expect(serialized.ollamaTrainedNumCtx).toBe(131_072)
    expect(serialized.ollamaEffectiveNumCtx).toBe(65_536)
  })
})
