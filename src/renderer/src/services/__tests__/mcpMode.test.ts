import { describe, expect, it } from 'vitest'

import type { Assistant } from '../../types'
import { getEffectiveMcpMode } from '../../types'

describe('getEffectiveMcpMode', () => {
  it('returns mcpMode when explicitly set to auto', () => {
    const assistant = { settings: { mcpMode: 'auto' } } as Partial<Assistant> as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('auto')
  })

  it('returns disabled when mcpMode is explicitly disabled', () => {
    const assistant = { settings: { mcpMode: 'disabled' } } as Partial<Assistant> as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('disabled')
  })

  it('returns manual when mcpMode is explicitly manual', () => {
    const assistant = { settings: { mcpMode: 'manual' } } as Partial<Assistant> as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('manual')
  })

  it('falls back to disabled when settings has no mcpMode', () => {
    const assistant = { settings: {} } as Partial<Assistant> as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('disabled')
  })

  it('falls back to disabled when settings is missing entirely', () => {
    const assistant = {} as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('disabled')
  })
})
