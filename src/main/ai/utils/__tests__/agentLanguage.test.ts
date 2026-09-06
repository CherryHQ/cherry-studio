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

const { getEffectiveAgentLanguage } = await import('../agentLanguage')

function agentWithLanguage(language: unknown): AgentEntity {
  return { configuration: { language } } as unknown as AgentEntity
}

describe('getEffectiveAgentLanguage', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    preferenceGet.mockReturnValue(null)
  })

  it('returns null when neither per-agent nor global language provides a value', () => {
    preferenceGet.mockReturnValue(null)
    expect(getEffectiveAgentLanguage(agentWithLanguage(undefined))).toBeNull()
    expect(getEffectiveAgentLanguage({} as AgentEntity)).toBeNull()
  })

  it('inherits the global language when per-agent is unset', () => {
    preferenceGet.mockReturnValue('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage(undefined))).toBe('English')
  })

  it('per-agent string overrides the global default and is trimmed', () => {
    preferenceGet.mockReturnValue('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage('  Thai '))).toBe('Thai')
  })

  it('per-agent null explicitly opts out of an inherited global default', () => {
    preferenceGet.mockReturnValue('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage(null))).toBeNull()
  })

  it('invalid per-agent value (whitespace-only or oversized) inherits the global default', () => {
    preferenceGet.mockReturnValue('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage('   '))).toBe('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage('x'.repeat(51)))).toBe('English')
  })
  it('rejects values containing CR, LF or unicode line separators and inherits the global default', () => {
    preferenceGet.mockReturnValue('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage('English\nFrench'))).toBe('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage('English\rFrench'))).toBe('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage('English\u2028French'))).toBe('English')
    expect(getEffectiveAgentLanguage(agentWithLanguage('English\u2029French'))).toBe('English')
  })

  it('global value is normalized: whitespace trimmed, invalid treated as unset', () => {
    preferenceGet.mockReturnValue('  中文 ')
    expect(getEffectiveAgentLanguage(agentWithLanguage(undefined))).toBe('中文')

    preferenceGet.mockReturnValue('x'.repeat(51))
    expect(getEffectiveAgentLanguage(agentWithLanguage(undefined))).toBeNull()

    preferenceGet.mockReturnValue('')
    expect(getEffectiveAgentLanguage(agentWithLanguage(undefined))).toBeNull()
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
