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

const { normalizeAgentLanguage, resolveEffectiveAgentLanguage } = await import('../agentLanguage')
const { AGENT_LANGUAGE_MAX_LENGTH } = await import('@shared/data/api/schemas/agents')

function agentWithLanguage(language: unknown): AgentEntity {
  return { configuration: { language } } as unknown as AgentEntity
}

describe('normalizeAgentLanguage', () => {
  it('trims surrounding whitespace and keeps interior text', () => {
    expect(normalizeAgentLanguage('  Thai  ')).toBe('Thai')
    expect(normalizeAgentLanguage('ไทย')).toBe('ไทย')
  })

  it('returns null for empty, whitespace-only, and non-string values', () => {
    expect(normalizeAgentLanguage('')).toBeNull()
    expect(normalizeAgentLanguage('   ')).toBeNull()
    expect(normalizeAgentLanguage(null)).toBeNull()
    expect(normalizeAgentLanguage(undefined)).toBeNull()
    expect(normalizeAgentLanguage(42)).toBeNull()
  })

  it('rejects values over the max length instead of truncating', () => {
    expect(normalizeAgentLanguage('a'.repeat(AGENT_LANGUAGE_MAX_LENGTH))).toBe('a'.repeat(AGENT_LANGUAGE_MAX_LENGTH))
    expect(normalizeAgentLanguage('a'.repeat(AGENT_LANGUAGE_MAX_LENGTH + 1))).toBeNull()
  })
})

describe('resolveEffectiveAgentLanguage', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    preferenceGet.mockReturnValue(null)
  })

  it('returns null when neither per-agent nor global language is set', () => {
    preferenceGet.mockReturnValue(null)

    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined))).toBeNull()
    expect(resolveEffectiveAgentLanguage({} as AgentEntity)).toBeNull()
  })

  it('inherits the global language when per-agent is unset', () => {
    preferenceGet.mockReturnValue('English')

    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined))).toBe('English')
  })

  it('per-agent string overrides the global default and is trimmed', () => {
    preferenceGet.mockReturnValue('English')

    expect(resolveEffectiveAgentLanguage(agentWithLanguage('  Thai '))).toBe('Thai')
  })

  it('per-agent null explicitly opts out of an inherited global default', () => {
    preferenceGet.mockReturnValue('English')

    expect(resolveEffectiveAgentLanguage(agentWithLanguage(null))).toBeNull()
  })

  it('per-agent whitespace-only inherits the global default', () => {
    preferenceGet.mockReturnValue('English')

    expect(resolveEffectiveAgentLanguage(agentWithLanguage('   '))).toBe('English')
  })

  it('global value is normalized: whitespace trimmed, oversized treated as unset', () => {
    preferenceGet.mockReturnValue('  中文 ')

    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined))).toBe('中文')

    preferenceGet.mockReturnValue('x'.repeat(51))
    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined))).toBeNull()
  })

  it('returns null when the PreferenceService is unavailable', () => {
    preferenceGet.mockImplementation(() => {
      throw new Error('service not ready')
    })

    expect(resolveEffectiveAgentLanguage(agentWithLanguage(undefined))).toBeNull()
  })
})
