import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { preferenceGet } = vi.hoisted(() => ({ preferenceGet: vi.fn() }))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') return { get: preferenceGet }
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

const { getEffectiveAgentLanguage, resolveEffectiveAgentLanguage } = await import('../agentLanguage')

function agentWithLanguage(language: unknown): AgentEntity {
  return { configuration: { language } } as unknown as AgentEntity
}

describe('resolveEffectiveAgentLanguage', () => {
  it('returns null when neither per-agent nor global language provides a value', () => {
    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined), null)).toBeNull()
    expect(resolveEffectiveAgentLanguage({} as AgentEntity, null)).toBeNull()
  })

  it('inherits the global language when per-agent is unset', () => {
    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined), 'English')).toBe('English')
  })

  it('per-agent string overrides the global default and is trimmed', () => {
    expect(resolveEffectiveAgentLanguage(agentWithLanguage('  Thai '), 'English')).toBe('Thai')
  })

  it('per-agent null explicitly opts out of an inherited global default', () => {
    expect(resolveEffectiveAgentLanguage(agentWithLanguage(null), 'English')).toBeNull()
  })

  it('invalid per-agent value (whitespace-only or oversized) inherits the global default', () => {
    expect(resolveEffectiveAgentLanguage(agentWithLanguage('   '), 'English')).toBe('English')
    expect(resolveEffectiveAgentLanguage(agentWithLanguage('x'.repeat(51)), 'English')).toBe('English')
  })

  it('global value is normalized: whitespace trimmed, invalid treated as unset', () => {
    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined), '  中文 ')).toBe('中文')
    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined), 'x'.repeat(51))).toBeNull()
    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined), '')).toBeNull()
  })
})

describe('getEffectiveAgentLanguage', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    preferenceGet.mockReturnValue(null)
  })

  it('resolves against the live agent.language preference', () => {
    preferenceGet.mockReturnValue('English')

    expect(getEffectiveAgentLanguage(agentWithLanguage(undefined))).toBe('English')

    preferenceGet.mockReturnValue('ไทย')
    expect(getEffectiveAgentLanguage(agentWithLanguage(undefined))).toBe('ไทย')
  })

  it('propagates PreferenceService failures instead of silently dropping the constraint', () => {
    preferenceGet.mockImplementation(() => {
      throw new Error('service not ready')
    })

    expect(() => getEffectiveAgentLanguage(agentWithLanguage(undefined))).toThrow('service not ready')
  })
})
