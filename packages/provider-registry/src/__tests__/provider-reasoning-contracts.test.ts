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
  it.each(['anthropic', 'aws-bedrock'])('keeps Claude Opus 4.5 on budget thinking for %s', (providerId) => {
    const contract = override(providerId, 'claude-opus-4-5').reasoningContracts?.['anthropic-messages']
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
