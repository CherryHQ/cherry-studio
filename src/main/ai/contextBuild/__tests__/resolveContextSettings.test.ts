import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import { describe, expect, it } from 'vitest'

import { resolveContextSettings } from '../resolveContextSettings'

const globals = DEFAULT_CONTEXT_SETTINGS

describe('resolveContextSettings', () => {
  it('returns globals when no overrides', () => {
    expect(resolveContextSettings({ globals })).toEqual(globals)
  })

  it('topic over assistant over global, per field', () => {
    const out = resolveContextSettings({
      globals,
      assistant: { truncateThreshold: 50_000, compress: { enabled: false } },
      topic: { truncateThreshold: 20_000 }
    })
    expect(out.truncateThreshold).toBe(20_000) // topic wins
    expect(out.compress.enabled).toBe(false) // assistant wins (topic silent)
    expect(out.enabled).toBe(true) // global floor
  })

  it('explicit compress.modelId from any layer wins; else null', () => {
    expect(resolveContextSettings({ globals }).compress.modelId).toBeNull()
    const out = resolveContextSettings({
      globals,
      assistant: { compress: { enabled: true, modelId: 'openai::gpt-4o-mini' } }
    })
    expect(out.compress.modelId).toBe('openai::gpt-4o-mini')
  })
})
