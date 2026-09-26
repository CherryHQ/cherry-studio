import { describe, expect, it } from 'vitest'

import {
  applyUserReasoningEffortTranslation,
  mergeUserReasoningEffortMaps,
  resolveEffectiveUserEffortMap,
  sanitizeUserReasoningEffortMap
} from '../reasoningEffortMappings'

describe('reasoningEffortMappings', () => {
  it('merges override layers with later scopes winning per key', () => {
    expect(
      resolveEffectiveUserEffortMap(
        {
          global: { high: 'medium' },
          providers: {
            openai: {
              default: { high: 'low' },
              families: { 'gpt-5': { high: 'max' } },
              models: { 'gpt-5': { medium: 'high' } }
            }
          }
        },
        { providerId: 'openai', modelId: 'gpt-5', modelFamily: 'gpt-5', uniqueModelId: 'openai::gpt-5' }
      )
    ).toEqual({
      high: 'max',
      medium: 'high'
    })
  })

  it('translates a tier through the user map before wire resolution', () => {
    expect(applyUserReasoningEffortTranslation('high', { high: 'medium' })).toBe('medium')
    expect(applyUserReasoningEffortTranslation('default', { high: 'medium' })).toBe('default')
  })

  it('drops unsupported targets when sanitizing for a model vocabulary', () => {
    expect(sanitizeUserReasoningEffortMap({ high: 'max', low: 'medium' }, ['low', 'medium', 'high'])).toEqual({
      low: 'medium'
    })
  })

  it('mergeUserReasoningEffortMaps shallow-merges keys', () => {
    expect(mergeUserReasoningEffortMaps({ low: 'minimal' }, { high: 'max' }, { low: 'medium' })).toEqual({
      low: 'medium',
      high: 'max'
    })
  })
})
