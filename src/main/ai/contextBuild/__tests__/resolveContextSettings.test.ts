import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'

import { resolveContextSettings } from '../resolveContextSettings'

const globals = DEFAULT_CONTEXT_SETTINGS

describe('resolveContextSettings', () => {
  it('returns globals when no overrides', () => {
    expect(resolveContextSettings({ globals })).toEqual(globals)
  })

  it('assistant over global, per field', () => {
    const out = resolveContextSettings({
      globals,
      assistant: { truncateThreshold: 20_000, compress: { enabled: false } }
    })
    expect(out.truncateThreshold).toBe(20_000) // assistant wins
    expect(out.compress.enabled).toBe(false) // assistant wins
    expect(out.enabled).toBe(true) // global floor (assistant silent)
  })

  // Three-state, so it merges by property PRESENCE: an explicit "no limit"
  // must beat a finite global, which `??` cannot express.
  it('maxMessages: absent inherits, a value wins, an explicit null means unlimited', () => {
    const limited = { ...globals, maxMessages: 5 }
    expect(resolveContextSettings({ globals: limited }).maxMessages).toBe(5)
    expect(resolveContextSettings({ globals: limited, assistant: {} }).maxMessages).toBe(5)
    expect(resolveContextSettings({ globals: limited, assistant: { maxMessages: 1 } }).maxMessages).toBe(1)
    expect(resolveContextSettings({ globals: limited, assistant: { maxMessages: null } }).maxMessages).toBeNull()
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
