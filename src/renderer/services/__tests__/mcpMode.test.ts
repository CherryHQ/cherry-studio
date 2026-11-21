import { describe, expect, it } from 'vitest'

import type { Assistant } from '@renderer/types/assistant'
import { getEffectiveMcpMode, hasMcpToolSignals } from '@renderer/utils/mcpMode'

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
})

describe('hasMcpToolSignals', () => {
  const make = (mcpMode: string | undefined, mcpServerIds: string[]) =>
    ({ settings: { mcpMode }, mcpServerIds }) as Partial<Assistant> as Assistant

  it('treats manual mode with no linked servers as no tool signal', () => {
    expect(hasMcpToolSignals(make('manual', []))).toBe(false)
    expect(hasMcpToolSignals(make(undefined, []))).toBe(false)
  })

  it('counts auto mode and manual mode with linked servers', () => {
    expect(hasMcpToolSignals(make('auto', []))).toBe(true)
    expect(hasMcpToolSignals(make('manual', ['s1']))).toBe(true)
  })

  it('never counts disabled mode, even with linked servers', () => {
    expect(hasMcpToolSignals(make('disabled', ['s1']))).toBe(false)
  })

  it('uses the loaded active servers: Auto with none, or Manual with no active link, is no signal', () => {
    const server = (id: string, name = id) => ({ id, name, type: 'stdio' }) as never
    const browser = { id: 'b', name: '@cherry/browser', type: 'inMemory' } as never
    expect(hasMcpToolSignals(make('auto', []), [])).toBe(false)
    expect(hasMcpToolSignals(make('auto', []), [browser])).toBe(false)
    expect(hasMcpToolSignals(make('auto', []), [server('s1')])).toBe(true)
    expect(hasMcpToolSignals(make('manual', ['s1']), [server('s2')])).toBe(false)
    expect(hasMcpToolSignals(make('manual', ['s1']), [server('s1')])).toBe(true)
  })
})
