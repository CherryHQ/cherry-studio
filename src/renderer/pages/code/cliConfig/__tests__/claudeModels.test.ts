import { describe, expect, it } from 'vitest'

import {
  getClaudeContextModelId,
  hasClaudeDetailedModels,
  stripClaudeDetailedModels,
  stripClaudeOneMMarker
} from '../claudeModels'

describe('stripClaudeOneMMarker', () => {
  it('strips a trailing [1M] marker (case-insensitive, trailing spaces tolerated)', () => {
    expect(stripClaudeOneMMarker('claude-fable-5 [1M]')).toBe('claude-fable-5')
    expect(stripClaudeOneMMarker('claude-fable-5[1m]  ')).toBe('claude-fable-5')
  })

  it('leaves values without the marker untouched', () => {
    expect(stripClaudeOneMMarker('claude-fable-5')).toBe('claude-fable-5')
    expect(stripClaudeOneMMarker('[1M] claude')).toBe('[1M] claude')
  })
})

describe('hasClaudeDetailedModels', () => {
  it('detects any populated detailed-model role', () => {
    expect(hasClaudeDetailedModels({ env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku' } })).toBe(true)
  })

  it('ignores empty, whitespace-only, and marker-only values', () => {
    expect(hasClaudeDetailedModels({})).toBe(false)
    expect(hasClaudeDetailedModels({ env: { ANTHROPIC_DEFAULT_FABLE_MODEL: '  ' } })).toBe(false)
    expect(hasClaudeDetailedModels({ env: { ANTHROPIC_DEFAULT_FABLE_MODEL: '[1M]' } })).toBe(false)
  })
})

describe('stripClaudeDetailedModels', () => {
  it('removes every detailed model/name key but keeps the rest of env', () => {
    const config = {
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'Fable',
        USER_ENV: 'keep'
      },
      permissions: { defaultMode: 'plan' }
    }

    expect(stripClaudeDetailedModels(config)).toEqual({
      env: { USER_ENV: 'keep' },
      permissions: { defaultMode: 'plan' }
    })
  })

  it('drops env entirely when only detailed keys were present', () => {
    expect(stripClaudeDetailedModels({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus' } })).toEqual({})
  })

  it('returns the config as-is when there is no env', () => {
    const config = { permissions: { defaultMode: 'plan' } }
    expect(stripClaudeDetailedModels(config)).toBe(config)
  })
})

describe('getClaudeContextModelId', () => {
  it('picks the highest-priority populated role (fable > opus > sonnet > haiku)', () => {
    expect(
      getClaudeContextModelId('anthropic', {
        env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku', ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus' }
      })
    ).toBe('anthropic::claude-opus')
  })

  it('strips the [1M] marker before building the unique id', () => {
    expect(
      getClaudeContextModelId('anthropic', { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5 [1M]' } })
    ).toBe('anthropic::claude-fable-5')
  })

  it('returns undefined when no role is populated', () => {
    expect(getClaudeContextModelId('anthropic', {})).toBeUndefined()
  })

  it('returns undefined for a user-typed value createUniqueModelId rejects instead of throwing', () => {
    expect(
      getClaudeContextModelId('anthropic', { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude?fable' } })
    ).toBeUndefined()
  })
})
