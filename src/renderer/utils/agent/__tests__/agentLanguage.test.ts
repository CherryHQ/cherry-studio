import { describe, expect, it } from 'vitest'

import {
  AGENT_LANGUAGE_MAX_LENGTH,
  AGENT_LANGUAGE_PRESETS,
  normalizeAgentLanguageInput,
  resolveAgentLanguagePreview,
  validateAgentLanguageInput
} from '../agentLanguage'

describe('validateAgentLanguageInput', () => {
  it('accepts a plain label', () => {
    expect(validateAgentLanguageInput('English')).toEqual({ ok: true, value: 'English' })
  })

  it('trims surrounding whitespace before validating', () => {
    expect(validateAgentLanguageInput('  ไทย  ')).toEqual({ ok: true, value: 'ไทย' })
  })

  it('rejects empty and whitespace-only input so blank drafts never persist', () => {
    expect(validateAgentLanguageInput('')).toEqual({ ok: false, errorKey: 'settings.agent.language.error.empty' })
    expect(validateAgentLanguageInput('   ')).toEqual({
      ok: false,
      errorKey: 'settings.agent.language.error.empty'
    })
  })

  it('rejects non-string input', () => {
    expect(validateAgentLanguageInput(null).ok).toBe(false)
    expect(validateAgentLanguageInput(42).ok).toBe(false)
  })

  it('caps labels at 50 chars to mirror AgentLanguageSchema', () => {
    expect(validateAgentLanguageInput('a'.repeat(AGENT_LANGUAGE_MAX_LENGTH)).ok).toBe(true)
    expect(validateAgentLanguageInput('a'.repeat(AGENT_LANGUAGE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      errorKey: 'settings.agent.language.error.too_long'
    })
  })

  // The last two cases embed U+2028 / U+2029 literally.
  it.each(['a\rb', 'a\nb', 'a b', 'a b'])('rejects multiline input %j', (raw) => {
    expect(validateAgentLanguageInput(raw)).toEqual({
      ok: false,
      errorKey: 'settings.agent.language.error.multiline'
    })
  })
})

describe('normalizeAgentLanguageInput', () => {
  it('returns the trimmed label for valid input and null otherwise', () => {
    expect(normalizeAgentLanguageInput('  English  ')).toBe('English')
    expect(normalizeAgentLanguageInput('  ')).toBeNull()
    expect(normalizeAgentLanguageInput('a\nb')).toBeNull()
  })
})

describe('resolveAgentLanguagePreview', () => {
  it('opts out when the mode is off even with a global language set', () => {
    expect(resolveAgentLanguagePreview('off', 'English', '日本語')).toBeNull()
  })

  it('inherits the global language', () => {
    expect(resolveAgentLanguagePreview('inherit', '', '日本語')).toBe('日本語')
  })

  it('prefers a valid custom draft over the global language', () => {
    expect(resolveAgentLanguagePreview('custom', '  Thai ', '日本語')).toBe('Thai')
  })

  it('falls back to the global language while the custom draft is invalid', () => {
    expect(resolveAgentLanguagePreview('custom', '   ', '日本語')).toBe('日本語')
  })
})

describe('AGENT_LANGUAGE_PRESETS', () => {
  // Guards the preset list against schema drift: every preset must survive validation.
  it.each(AGENT_LANGUAGE_PRESETS)('preset %s validates', (preset) => {
    expect(validateAgentLanguageInput(preset)).toEqual({ ok: true, value: preset })
  })
})
