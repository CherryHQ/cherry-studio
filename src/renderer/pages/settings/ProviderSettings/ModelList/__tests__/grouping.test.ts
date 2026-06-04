import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n/label', () => ({
  hasProviderLabel: (id: string) => id === 'openai' || id === 'minimax-global',
  getProviderLabel: (id: string) => {
    if (id === 'openai') return 'OpenAI'
    if (id === 'minimax-global') return 'MiniMax Global'
    return id
  }
}))

import {
  getModelGroupDisplayName,
  getModelGroupLabel,
  normalizeModelGroupName,
  UNGROUPED_MODEL_GROUP_KEY
} from '../grouping'

describe('getModelGroupDisplayName', () => {
  it('uses localised provider labels for known provider IDs', () => {
    expect(getModelGroupDisplayName('openai')).toBe('OpenAI')
    expect(getModelGroupDisplayName('minimax-global')).toBe('MiniMax Global')
  })

  it('humanises known provider-style aliases', () => {
    expect(getModelGroupDisplayName('black-forest-labs')).toBe('Black Forest Labs')
    expect(getModelGroupDisplayName('deepseek-ai')).toBe('DeepSeek')
    expect(getModelGroupDisplayName('DeepSeek-AI')).toBe('DeepSeek')
    expect(getModelGroupDisplayName('mistralai')).toBe('Mistral AI')
    expect(getModelGroupDisplayName('MISTRALAI')).toBe('Mistral AI')
    expect(getModelGroupDisplayName('x-ai')).toBe('xAI')
    expect(getModelGroupDisplayName('X-AI')).toBe('xAI')
    expect(getModelGroupDisplayName('xai')).toBe('xAI')
    expect(getModelGroupDisplayName('qwen')).toBe('Qwen')
    expect(getModelGroupDisplayName('google')).toBe('Google')
    expect(getModelGroupDisplayName('cartesia')).toBe('Cartesia')
    expect(getModelGroupDisplayName('hexgrad')).toBe('Hexgrad')
    expect(getModelGroupDisplayName('meta')).toBe('Meta')
    expect(getModelGroupDisplayName('nvidia')).toBe('NVIDIA')
  })

  it('preserves canonical model family identifiers', () => {
    expect(getModelGroupDisplayName('Pro')).toBe('Pro')
    expect(getModelGroupDisplayName('gpt-5')).toBe('gpt-5')
    expect(getModelGroupDisplayName('gpt-image')).toBe('gpt-image')
    expect(getModelGroupDisplayName('gpt-4.1-mini')).toBe('gpt-4.1-mini')
    expect(getModelGroupDisplayName('GPT4')).toBe('GPT4')
    expect(getModelGroupDisplayName('APIKey')).toBe('APIKey')
    expect(getModelGroupDisplayName('MyModel')).toBe('MyModel')
    expect(getModelGroupDisplayName('moonshot-v1')).toBe('moonshot-v1')
    expect(getModelGroupDisplayName('GLM-4.5')).toBe('GLM-4.5')
  })

  it('returns empty string for empty input', () => {
    expect(getModelGroupDisplayName('')).toBe('')
    expect(getModelGroupDisplayName('   ')).toBe('')
  })

  it('trims whitespace', () => {
    expect(getModelGroupDisplayName('  openai  ')).toBe('OpenAI')
    expect(getModelGroupDisplayName('  deepseek-ai  ')).toBe('DeepSeek')
  })
})

describe('normalizeModelGroupName', () => {
  it('returns trimmed group when valid', () => {
    expect(normalizeModelGroupName('deepseek')).toBe('deepseek')
    expect(normalizeModelGroupName('  gpt-5  ')).toBe('gpt-5')
  })

  it('falls back when group is empty or undefined', () => {
    expect(normalizeModelGroupName(null, 'fallback')).toBe('fallback')
    expect(normalizeModelGroupName(undefined, 'fallback')).toBe('fallback')
    expect(normalizeModelGroupName('', 'fallback')).toBe('fallback')
  })

  it('returns UNGROUPED_MODEL_GROUP_KEY when no group or fallback', () => {
    expect(normalizeModelGroupName(null)).toBe(UNGROUPED_MODEL_GROUP_KEY)
    expect(normalizeModelGroupName(undefined)).toBe(UNGROUPED_MODEL_GROUP_KEY)
  })

  it('treats literal "undefined" string as empty', () => {
    expect(normalizeModelGroupName('undefined', 'fallback')).toBe('fallback')
    expect(normalizeModelGroupName('UNDEFINED', 'fallback')).toBe('fallback')
  })
})

describe('getModelGroupLabel', () => {
  const t = (key: string) => {
    if (key === 'assistants.tags.untagged') return 'Untagged'
    return key
  }

  it('returns translation for ungrouped key', () => {
    expect(getModelGroupLabel(UNGROUPED_MODEL_GROUP_KEY, t as any)).toBe('Untagged')
  })

  it('returns raw group name for non-ungrouped', () => {
    expect(getModelGroupLabel('deepseek', t as any)).toBe('deepseek')
    expect(getModelGroupLabel('gpt-5', t as any)).toBe('gpt-5')
  })
})
