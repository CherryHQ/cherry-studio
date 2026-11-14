import { describe, expect, it } from 'vitest'

import { providerModelEntries as entries } from '../../scripts/canonicalize'
import { PROVIDERS } from '../providers'

const provider = (providerId: string) => {
  const result = PROVIDERS.find(({ id }) => id === providerId)
  if (!result) throw new Error(`Missing provider: ${providerId}`)
  return result
}

const override = (providerId: string, modelId: string) => {
  const result = entries(provider(providerId)).find((entry) => entry.modelId === modelId)
  if (!result) throw new Error(`Missing override: ${providerId}/${modelId}`)
  return result
}

describe('provider reasoning contracts', () => {
  it.each(['kimi-k3', 'kimi-k3-fast'])('gives Moonshot %s an effort wire of its own', (modelId) => {
    // The provider wire only carries `thinking.type`; without this contract every tier collapses to it.
    const moonshotWire = override('moonshot', modelId).reasoningContracts?.['openai-chat-completions']?.wire

    expect(moonshotWire?.effort?.operations).toEqual([{ target: 'reasoningEffort', value: { source: 'effort' } }])
  })

  // `auto` is the one selection no model validates, so the serializer projects a profile's automatic
  // tier onto the model's declared efforts. A tier buried in a literal operation is invisible to it
  // and reaches the wire unchecked — which is how Kimi K3 received `medium` and returned 400 (#20029).
  it('declares every automatic effort tier through effortMap, never as a literal', () => {
    const tiers = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    const offenders: string[] = []

    for (const entry of PROVIDERS) {
      const wires = [
        ...Object.entries(entry.endpointConfigs ?? {}).map(
          ([endpoint, config]) => [`${entry.id}/${endpoint}`, config.reasoningFormat?.wire] as const
        ),
        ...entries(entry).flatMap((model) =>
          Object.entries(model.reasoningContracts ?? {}).map(
            ([endpoint, contract]) => [`${entry.id}/${model.modelId}/${endpoint}`, contract.wire] as const
          )
        )
      ]

      for (const [label, wire] of wires) {
        for (const operation of wire?.auto?.operations ?? []) {
          if (operation.value.source === 'literal' && tiers.has(String(operation.value.value))) {
            offenders.push(`${label} → ${operation.target}=${operation.value.value}`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps DashScope Kimi K3 reasoning within the provider-supported effort vocabulary', () => {
    const dashscopeSupport = override('dashscope', 'kimi-k3').reasoningContracts?.['openai-chat-completions']?.support

    expect(dashscopeSupport?.controls).toEqual([{ default: 'max', kind: 'effort', values: ['none', 'max'] }])
  })

  // Every shipping DeepSeek V4 model must offer the off switch and translate xhigh to max.

  it('carries the off switch on the provider-level DeepSeek Responses endpoint', () => {
    const responsesFormat = provider('deepseek').endpointConfigs?.['openai-responses']?.reasoningFormat as {
      wire?: { off?: { operations?: unknown[] } }
    }
    expect(responsesFormat?.wire?.off?.operations).toEqual([
      { target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }
    ])
  })

  // The generic deepseek wire serves deepseek-chat / deepseek-reasoner (reasoningFamilies toggle
  // models with no per-model override). The @ai-sdk/deepseek schema only accepts thinking.type
  // 'enabled' | 'disabled', so auto must never serialize the literal 'auto' (issue #18270).

  // Bedrock keeps a hand-pinned contract: its budget wire is in bedrock's own
  // `reasoningConfig.*` namespace, so it isn't the shared anthropic dialect.
  // The first-party anthropic pin is gone — Opus 4.5 now reaches the same wire
  // through `wireDialect: 'budget'` (locked in reasoning-dialect.test.ts).
  it('uses adaptive effort for Claude Opus 5.5 on aws-bedrock', () => {
    const model = override('aws-bedrock', 'claude-opus-5-5')
    expect(model.apiModelId).toBe('global.anthropic.claude-opus-5-5')
    const contract = model.reasoningContracts?.['anthropic-messages']
    expect(contract?.wire?.effort?.operations).toEqual([
      { target: 'reasoningConfig.type', value: { source: 'literal', value: 'adaptive' } },
      { target: 'reasoningConfig.maxReasoningEffort', value: { source: 'effort' } }
    ])
  })

  // No provider hand-pins a Gemini dialect any more — it comes from the model's
  // declared `wireDialect`, so a new google-generate-content gateway cannot get
  // it wrong by omission. Coverage lives in reasoning-dialect.test.ts.

  // Poe serves Responses natively; Chat Completions remains fail-closed and
  // retains only audited per-model wire contracts.
  it('routes Poe chat through the Responses endpoint with standard reasoning', () => {
    const poe = provider('poe')
    expect(poe.defaultChatEndpoint).toBe('openai-responses')
    expect(poe.endpointConfigs?.['openai-responses']?.reasoningFormat).toEqual({ type: 'openai-responses' })
    expect(poe.endpointConfigs?.['openai-chat-completions']?.reasoningFormat?.wire).toEqual({ disabled: true })
  })

  // Poe's Responses emulation breaks Claude streams, so the full official roster
  // must prefer Anthropic Messages.
  it('pins every official Poe Claude bot to anthropic-messages first', () => {
    const expected = [
      'claude-haiku-4-5',
      'claude-opus-4-5',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-5',
      'claude-sonnet-4-6'
    ]
    const claudeOverrides = entries(provider('poe')).filter(({ modelId }) => modelId.startsWith('claude-'))
    expect(claudeOverrides.map(({ modelId }) => modelId).sort()).toEqual(expected)
    for (const entry of claudeOverrides) {
      expect(entry.endpointTypes?.[0], entry.modelId).toBe('anthropic-messages')
    }
  })

  it.each([
    ['gpt-oss-20b', 'accounts/fireworks/models/gpt-oss-20b'],
    ['minimax-m2-7', 'accounts/fireworks/models/minimax-m2p7']
  ])('keeps the Fireworks wire identity for de-listed model %s', (modelId, apiModelId) => {
    expect(override('fireworks', modelId).apiModelId).toBe(apiModelId)
  })
})

// QwenCloud serves DeepSeek-V4 and GLM-5.2 on both Chat and Responses, each with its own
// documented effort ladder (docs third-party-models pages + the Responses API reference).
describe('qwencloud reasoning contracts', () => {
  // The Responses ladder is endpoint-wide: seven tiers documented to default to `xhigh`.
  it('carries the endpoint-wide Responses ladder on the dual-endpoint third-party lines', () => {
    for (const modelId of ['deepseek-v4-pro', 'deepseek-v4-flash', 'glm-5-2']) {
      const support = override('qwencloud', modelId).reasoningContracts?.['openai-responses']?.support
      expect(support?.supportedEfforts).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
      expect(support?.defaultEffort).toBe('xhigh')
    }
  })

  it('keeps DeepSeek-V4 Chat on its five-tier high-default ladder', () => {
    const support = override('qwencloud', 'deepseek-v4-pro').reasoningContracts?.['openai-chat-completions']?.support
    expect(support?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(support?.defaultEffort).toBe('high')
  })

  it('drops the unsupported max tier from glm-5.1 Chat', () => {
    const support = override('qwencloud', 'glm-5-1').reasoningContracts?.['openai-chat-completions']?.support
    expect(support?.supportedEfforts).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
  })

  // `enable_thinking` outranks `reasoning_effort`, so the effort tier must pin thinking on
  // explicitly instead of leaning on the models' thinking-on default.
  it('pins enable_thinking on the third-party effort wire', () => {
    const wire = override('qwencloud', 'glm-5-2').reasoningContracts?.['openai-chat-completions']?.wire
    const targets = wire?.effort?.operations?.map((op) => [op.target, op.value])
    expect(targets).toEqual(
      expect.arrayContaining([
        ['enable_thinking', { source: 'literal', value: true }],
        ['reasoning_effort', { source: 'effort' }]
      ])
    )
  })
})
