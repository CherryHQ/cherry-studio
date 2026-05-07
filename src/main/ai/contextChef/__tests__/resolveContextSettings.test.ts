import type { EffectiveContextSettings } from '@shared/data/types/contextSettings'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import { describe, expect, it } from 'vitest'

import { resolveContextSettings } from '../resolveContextSettings'

const baseGlobals: EffectiveContextSettings = DEFAULT_CONTEXT_SETTINGS

describe('resolveContextSettings', () => {
  it('returns globals as-is when both topic and assistant overrides are absent', () => {
    const result = resolveContextSettings({ globals: baseGlobals })
    expect(result).toEqual(baseGlobals)
  })

  it('applies non-overlapping fields from assistant and topic overrides', () => {
    const result = resolveContextSettings({
      globals: baseGlobals,
      assistant: { truncateThreshold: 8000 },
      topic: { enabled: false }
    })
    expect(result.enabled).toBe(false)
    expect(result.truncateThreshold).toBe(8000)
    expect(result.compress).toEqual(baseGlobals.compress)
  })

  it('topic override beats assistant override when both set the same field', () => {
    const result = resolveContextSettings({
      globals: baseGlobals,
      assistant: { truncateThreshold: 8000 },
      topic: { truncateThreshold: 12000 }
    })
    expect(result.truncateThreshold).toBe(12000)
  })

  describe('compress.modelId resolution chain', () => {
    it('topic explicit modelId wins over everything', () => {
      const result = resolveContextSettings({
        globals: { ...baseGlobals, compress: { enabled: true, modelId: 'global:m' } },
        assistant: { compress: { enabled: true, modelId: 'assistant:m' } },
        topic: { compress: { enabled: true, modelId: 'topic:m' } },
        topicNamingModelId: 'naming:m'
      })
      expect(result.compress.modelId).toBe('topic:m')
    })

    it('assistant explicit modelId wins when topic does not specify one', () => {
      const result = resolveContextSettings({
        globals: { ...baseGlobals, compress: { enabled: true, modelId: 'global:m' } },
        assistant: { compress: { enabled: true, modelId: 'assistant:m' } },
        topicNamingModelId: 'naming:m'
      })
      expect(result.compress.modelId).toBe('assistant:m')
    })

    it('global modelId wins when neither assistant nor topic specifies one', () => {
      const result = resolveContextSettings({
        globals: { ...baseGlobals, compress: { enabled: true, modelId: 'global:m' } },
        topicNamingModelId: 'naming:m'
      })
      expect(result.compress.modelId).toBe('global:m')
    })

    it('falls back to topicNamingModelId when no explicit modelId at any layer', () => {
      const result = resolveContextSettings({
        globals: baseGlobals,
        topicNamingModelId: 'naming:m'
      })
      expect(result.compress.modelId).toBe('naming:m')
    })

    it('returns null when topicNamingModelId is undefined and no explicit modelId is set', () => {
      const result = resolveContextSettings({ globals: baseGlobals })
      expect(result.compress.modelId).toBeNull()
    })

    it('returns null when topicNamingModelId is explicitly null', () => {
      const result = resolveContextSettings({
        globals: baseGlobals,
        topicNamingModelId: null
      })
      expect(result.compress.modelId).toBeNull()
    })
  })

  describe('compress.enabled toggling', () => {
    it('topic can explicitly disable compression even when assistant enables it', () => {
      const result = resolveContextSettings({
        globals: baseGlobals,
        assistant: { compress: { enabled: true, modelId: 'assistant:m' } },
        topic: { compress: { enabled: false } }
      })
      expect(result.compress.enabled).toBe(false)
      // topic.compress is present but does not specify modelId -> falls through to assistant.
      expect(result.compress.modelId).toBe('assistant:m')
    })

    it('topic.compress overrides assistant when assistant.compress is undefined', () => {
      const result = resolveContextSettings({
        globals: baseGlobals,
        topic: { compress: { enabled: true, modelId: 'topic:m' } }
      })
      expect(result.compress.enabled).toBe(true)
      expect(result.compress.modelId).toBe('topic:m')
    })
  })

  it('treats topic = null the same as no topic override (falls through to assistant)', () => {
    const result = resolveContextSettings({
      globals: baseGlobals,
      assistant: { enabled: false, truncateThreshold: 7777 },
      topic: null
    })
    expect(result.enabled).toBe(false)
    expect(result.truncateThreshold).toBe(7777)
  })

  it('topic.compress.modelId beats globals.compress.modelId when both are explicitly set', () => {
    const result = resolveContextSettings({
      globals: { ...baseGlobals, compress: { enabled: true, modelId: 'global:m' } },
      topic: { compress: { enabled: true, modelId: 'topic:m' } }
    })
    expect(result.compress.modelId).toBe('topic:m')
  })

  it('preserves all three fields when every layer is partially populated', () => {
    const result = resolveContextSettings({
      globals: { enabled: true, truncateThreshold: 5000, compress: { enabled: false, modelId: null } },
      assistant: { compress: { enabled: true, modelId: 'assistant:m' } },
      topic: { truncateThreshold: 9000 },
      topicNamingModelId: 'naming:m'
    })
    expect(result).toEqual({
      enabled: true,
      truncateThreshold: 9000,
      compress: { enabled: true, modelId: 'assistant:m' }
    })
  })
})
