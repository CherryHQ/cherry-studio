import { describe, expect, it } from 'vitest'

import { DEFAULT_DEEPSEEK_HARNESS_SETTINGS, normalizeDeepSeekHarnessSettings } from '../codeCli'

describe('DeepSeek Harness settings input', () => {
  it('falls back independently without losing a valid permission mode', () => {
    expect(normalizeDeepSeekHarnessSettings({ agentPreset: 'unsupported', permissionMode: 'read-only' })).toEqual({
      agentPreset: 'inherit',
      permissionMode: 'read-only'
    })
  })

  it('falls back independently without losing a valid preset', () => {
    expect(normalizeDeepSeekHarnessSettings({ agentPreset: 'minimal', permissionMode: 'unsupported' })).toEqual({
      agentPreset: 'minimal',
      permissionMode: 'workspace-write'
    })
  })

  it('retains recognized fields without exposing unrelated stored config', () => {
    expect(
      normalizeDeepSeekHarnessSettings({ agentPreset: 'code', permissionMode: 'danger-full-access', apiKey: 'secret' })
    ).toEqual({ agentPreset: 'code', permissionMode: 'danger-full-access' })
  })

  it.each([undefined, null, false, 42, 'code', []].map((input) => ({ input })))(
    'defaults invalid root input: %j',
    ({ input }) => {
      expect(normalizeDeepSeekHarnessSettings(input)).toEqual(DEFAULT_DEEPSEEK_HARNESS_SETTINGS)
    }
  )

  it('returns independent mutable defaults for each invalid input', () => {
    const first = normalizeDeepSeekHarnessSettings(undefined)
    const second = normalizeDeepSeekHarnessSettings(undefined)
    first.agentPreset = 'code'

    expect(second).toEqual({ agentPreset: 'inherit', permissionMode: 'workspace-write' })
    expect(DEFAULT_DEEPSEEK_HARNESS_SETTINGS.agentPreset).toBe('inherit')
  })
})
