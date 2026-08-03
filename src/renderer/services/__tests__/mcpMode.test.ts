import type { Assistant } from '@renderer/types/assistant'
import { getEffectiveMcpMode } from '@renderer/utils/mcpMode'
import { describe, expect, it } from 'vitest'

describe('getEffectiveMcpMode', () => {
  it('returns mcpMode when explicitly set to auto', () => {
    const assistant = { settings: { mcpMode: 'auto' } } as Partial<Assistant> as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('auto')
  })

  it('falls back to disabled when settings is missing entirely', () => {
    const assistant = {} as Assistant
    expect(getEffectiveMcpMode(assistant)).toBe('disabled')
  })
})
