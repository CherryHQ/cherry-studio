import { describe, expect, it } from 'vitest'

import type { Assistant } from '@renderer/types/assistant'
import { getEffectiveMcpMode } from '@renderer/utils/mcpMode'

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

  // Fallback = the shared DEFAULT_MCP_MODE ('manual'): the same assistant must
  // resolve the same mode in main's resolver, this helper, and the composer
  // selector (runtime-test finding #6 — layers used to disagree).
  it('falls back to the shared default when settings has no mcpMode', () => {
    const assistant = { settings: {} } as Partial<Assistant> as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('manual')
  })

  it('falls back to the shared default when settings is missing entirely', () => {
    const assistant = {} as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('manual')
  })
})
