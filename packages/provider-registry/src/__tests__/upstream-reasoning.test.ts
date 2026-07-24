import { describe, expect, it } from 'vitest'

import { mergeOpenRouterReasoningContracts, parseOpenRouterReasoning } from '../../scripts/upstream'

describe('OpenRouter reasoning descriptor ingestion', () => {
  it('preserves supported efforts and removes none for mandatory models', () => {
    const support = parseOpenRouterReasoning({
      reasoning: {
        supported_efforts: ['none', 'low', 'medium', 'high'],
        default_effort: 'medium',
        mandatory: true
      }
    })

    expect(support).toEqual({
      controls: [{ kind: 'effort', values: ['low', 'medium', 'high'], default: 'medium' }],
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium'
    })
  })

  it('does not invent effort choices for max-token-only descriptors', () => {
    const support = parseOpenRouterReasoning({
      reasoning: { supports_max_tokens: true, default_enabled: true }
    })

    expect(support).toEqual({ controls: [] })
  })

  it('keeps hand-written endpoint fields above generated support', () => {
    const handwrittenWire = {
      effort: {
        operations: [{ target: 'reasoning.effort' as const, value: { source: 'effort' as const } }]
      }
    }
    const generatedSupport = {
      controls: [{ kind: 'effort' as const, values: ['low' as const, 'high' as const] }]
    }
    const handwrittenSupport = { controls: [{ kind: 'toggle' as const }] }

    const result = mergeOpenRouterReasoningContracts(generatedSupport, {
      'openai-chat-completions': { support: handwrittenSupport, wire: handwrittenWire }
    })

    expect(result['openai-chat-completions']).toEqual({ support: handwrittenSupport, wire: handwrittenWire })
  })
})
