import { describe, expect, it } from 'vitest'

import { PROVIDERS } from '../providers'

const provider = (providerId: string) => {
  const result = PROVIDERS.find(({ id }) => id === providerId)
  if (!result) throw new Error(`Missing provider: ${providerId}`)
  return result
}

const override = (providerId: string, modelId: string) => {
  const result = provider(providerId).overrides?.find((entry) => entry.modelId === modelId)
  if (!result) throw new Error(`Missing override: ${providerId}/${modelId}`)
  return result
}

describe('provider reasoning contracts', () => {
  it('encodes OpenRouter Off as an explicit none effort', () => {
    const wire = provider('openrouter').endpointConfigs?.['openai-chat-completions']?.reasoningFormat?.wire

    expect(wire?.off?.operations).toEqual([{ target: 'reasoning.effort', value: { source: 'literal', value: 'none' } }])
  })

  it('uses the documented DeepSeek V4 peak prices as the static catalog ceiling', () => {
    expect(override('deepseek', 'deepseek-v4-flash').pricing).toEqual({
      cacheRead: { currency: 'USD', perMillionTokens: 0.014 },
      input: { currency: 'USD', perMillionTokens: 0.44 },
      output: { currency: 'USD', perMillionTokens: 1.32 }
    })
    expect(override('deepseek', 'deepseek-v4-pro').pricing).toEqual({
      cacheRead: { currency: 'USD', perMillionTokens: 0.044 },
      input: { currency: 'USD', perMillionTokens: 1.32 },
      output: { currency: 'USD', perMillionTokens: 3.96 }
    })
  })

  it('keeps Kimi K3 reasoning within the provider-supported effort vocabulary', () => {
    const moonshotWire = override('moonshot', 'kimi-k3').reasoningContracts?.['openai-chat-completions']?.wire
    const dashscopeSupport = override('dashscope', 'kimi-k3').reasoningContracts?.['openai-chat-completions']?.support

    expect(moonshotWire?.auto?.effortMap).toEqual({ auto: 'high' })
    expect(dashscopeSupport?.controls).toEqual([{ default: 'max', kind: 'effort', values: ['none', 'max'] }])
  })

  // DeepSeek publishes one effort table for every V4 SKU (thinking_mode guide), so the Flash, Vision
  // and Pro contracts must not drift apart — and none may send `xhigh` verbatim, which DeepSeek
  // degrades to `high`.
  it.each(['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'])(
    'maps %s reasoning to the official effort vocabulary',
    (modelId) => {
      const contracts = override('deepseek', modelId).reasoningContracts
      const responsesWire = contracts?.['openai-responses']?.wire
      expect(responsesWire?.off?.operations).toEqual([
        { target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }
      ])
      expect(responsesWire?.auto?.effortMap).toEqual({
        auto: 'high',
        minimal: 'low',
        low: 'low',
        medium: 'high',
        xhigh: 'max'
      })
      expect(responsesWire?.effort).toMatchObject({
        operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }],
        effortMap: { minimal: 'low', low: 'low', medium: 'high', xhigh: 'max' }
      })
      expect(contracts?.['openai-chat-completions']?.wire?.effort).toMatchObject({
        operations: [
          { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } },
          { target: 'reasoningEffort', value: { source: 'effort' } }
        ],
        effortMap: { minimal: 'low', low: 'low', medium: 'high', xhigh: 'max' }
      })
    }
  )

  // The generic deepseek wire serves deepseek-chat / deepseek-reasoner (reasoningFamilies toggle
  // models with no per-model override). The @ai-sdk/deepseek schema only accepts thinking.type
  // 'enabled' | 'disabled', so auto must never serialize the literal 'auto' (issue #18270).
  it('maps the generic DeepSeek auto mode to thinking.type enabled', () => {
    const wire = provider('deepseek').endpointConfigs?.['openai-chat-completions']?.reasoningFormat?.wire
    expect(wire?.auto?.operations).toEqual([
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }
    ])
    expect(wire?.off?.operations).toEqual([
      { target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }
    ])
    expect(wire?.effort?.operations).toEqual([
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }
    ])
  })

  it('binds CherryIN DeepSeek reasoning to a currently served API identity', () => {
    const deepSeekOverrides = provider('cherryin').overrides?.filter(({ modelId }) => modelId?.startsWith('deepseek'))

    expect(deepSeekOverrides?.map(({ apiModelId, modelId }) => ({ apiModelId, modelId }))).toEqual([
      { apiModelId: 'deepseek/deepseek-v3.2', modelId: 'deepseek-v3-2' }
    ])
  })

  it('uses CherryIN extra_body thinking controls for the served DeepSeek V3.2 model', () => {
    const wire = provider('cherryin').overrides?.find(({ apiModelId }) => apiModelId === 'deepseek/deepseek-v3.2')
      ?.reasoningContracts?.['openai-chat-completions']?.wire

    expect(wire?.off?.operations).toEqual([
      { target: 'extra_body.thinking.type', value: { source: 'literal', value: 'disabled' } }
    ])
    expect(wire?.auto?.operations).toEqual([
      { target: 'extra_body.thinking.type', value: { source: 'literal', value: 'enabled' } }
    ])
    expect(wire?.effort?.operations).toEqual([
      { target: 'extra_body.thinking.type', value: { source: 'literal', value: 'enabled' } }
    ])
  })

  // Bedrock keeps a hand-pinned contract: its budget wire is in bedrock's own
  // `reasoningConfig.*` namespace, so it isn't the shared anthropic dialect.
  // The first-party anthropic pin is gone — Opus 4.5 now reaches the same wire
  // through `wireDialect: 'budget'` (locked in reasoning-dialect.test.ts).
  it('keeps Claude Opus 4.5 on budget thinking for aws-bedrock', () => {
    const contract = override('aws-bedrock', 'claude-opus-4-5').reasoningContracts?.['anthropic-messages']
    expect(contract?.wire?.effort).toMatchObject({
      budget: expect.any(Object),
      operations: expect.arrayContaining([expect.objectContaining({ value: { source: 'budget' } })])
    })
  })

  it('keeps NVIDIA unknown models fail-closed and declares audited controls per exact model', () => {
    const nvidia = provider('nvidia')
    expect(nvidia.endpointConfigs?.['openai-chat-completions']?.reasoningFormat?.wire).toEqual({ disabled: true })

    expect(
      override('nvidia', 'qwen3-5-122b-a10b').reasoningContracts?.['openai-chat-completions']?.wire?.auto
    ).toMatchObject({
      operations: [{ target: 'chat_template_kwargs.enable_thinking', value: { source: 'literal', value: true } }]
    })
    expect(override('nvidia', 'kimi-k2-6').reasoningContracts?.['openai-chat-completions']?.wire?.auto).toMatchObject({
      operations: [{ target: 'chat_template_kwargs.thinking', value: { source: 'literal', value: true } }]
    })
    expect(
      override('nvidia', 'deepseek-v4-pro').reasoningContracts?.['openai-chat-completions']?.wire?.effort?.operations
    ).toEqual([{ target: 'reasoning_effort', value: { source: 'effort' } }])
    expect(
      override('nvidia', 'deepseek-v4-pro').reasoningContracts?.['openai-chat-completions']?.support?.controls
    ).toEqual([{ kind: 'effort', values: ['none', 'high', 'max'], default: 'high' }])
  })

  it('uses each audited NVIDIA model endpoint vocabulary instead of one Nemotron family wire', () => {
    expect(
      override('nvidia', 'minimax-m3').reasoningContracts?.['openai-chat-completions']?.wire?.auto?.operations
    ).toEqual([{ target: 'chat_template_kwargs.thinking_mode', value: { source: 'literal', value: 'adaptive' } }])
    expect(
      override('nvidia', 'mistral-small-4-119b').reasoningContracts?.['openai-chat-completions']?.support?.controls
    ).toEqual([{ kind: 'effort', values: ['none', 'high'], default: 'high' }])
    expect(
      override('nvidia', 'nemotron-3-super-120b-a12b').reasoningContracts?.['openai-chat-completions']?.support
        ?.controls
    ).toEqual([{ kind: 'effort', values: ['none', 'low', 'high'], default: 'high' }])
    expect(
      override('nvidia', 'nemotron-3-ultra-550b-a55b').reasoningContracts?.['openai-chat-completions']?.support
        ?.controls
    ).toEqual([{ kind: 'effort', values: ['none', 'medium', 'high'], default: 'high' }])
    expect(
      override('nvidia', 'nemotron-3-nano-omni-30b-a3b').reasoningContracts?.['openai-chat-completions']?.wire?.effort
        ?.operations
    ).toEqual([{ target: 'reasoning_budget', value: { source: 'budget' } }])
    expect(
      override('nvidia', 'seed-oss-36b-instruct').reasoningContracts?.['openai-chat-completions']?.wire?.off?.operations
    ).toEqual([{ target: 'thinking_budget', value: { source: 'literal', value: 0 } }])
  })

  it.each([
    'glm-5-2',
    'minimax-m2-7',
    'nemotron-3-nano-30b-a3b',
    'nemotron-nano-9b-v2',
    'step-3-5-flash',
    'step-3-7-flash'
  ])('does not invent an NVIDIA reasoning control for %s', (modelId) => {
    expect(provider('nvidia').overrides?.some((entry) => entry.modelId === modelId && entry.reasoningContracts)).toBe(
      false
    )
  })

  // No provider hand-pins a Gemini dialect any more — it comes from the model's
  // declared `wireDialect`, so a new google-generate-content gateway cannot get
  // it wrong by omission. Coverage lives in reasoning-dialect.test.ts.
  it.each(['gemini', 'cherryin', 'new-api', 'vertexai'])(
    'declares no per-model Gemini dialect contract for %s',
    (providerId) => {
      const pinned = provider(providerId).overrides?.filter(
        (entry) => entry.reasoningContracts?.['google-generate-content']
      )
      expect(pinned ?? []).toEqual([])
    }
  )

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
    const claudeOverrides = provider('poe').overrides?.filter(({ modelId }) => modelId?.startsWith('claude-')) ?? []
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

  it('nests Poe custom reasoning parameters under extra_body', () => {
    expect(
      override('poe', 'gpt-5-4').reasoningContracts?.['openai-chat-completions']?.wire?.effort?.operations
    ).toEqual([{ target: 'extra_body.reasoning_effort', value: { source: 'effort' } }])
    expect(
      override('poe', 'claude-sonnet-4-6').reasoningContracts?.['openai-chat-completions']?.wire?.effort?.operations
    ).toEqual([{ target: 'extra_body.thinking_budget', value: { source: 'budget' } }])
  })

  it.each(['qwen3-coder', 'qwen3-coder-next'])('does not declare a DashScope reasoning contract for %s', (modelId) => {
    expect(
      provider('dashscope').overrides?.some((entry) => entry.modelId === modelId && entry.reasoningContracts)
    ).toBe(false)
  })
})
