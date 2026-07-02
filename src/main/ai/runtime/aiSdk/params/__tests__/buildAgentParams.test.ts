import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { StopCondition, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'

import { makeModel } from '../../../../__tests__/fixtures'
import type { CallOverrides } from '../../../../types/requests'
import type { AgentOptions } from '../../loop'
import { applyCallOverrides, applyResponsesInstructions, composeStopWhen } from '../buildAgentParams'

/**
 * Covers the first-class per-request override merge that replaced the old
 * `createGatewayOverrideFeature` plugin: assistant-less precedence, capability
 * gating via `filterStandardParams`, and per-provider providerOptions merging.
 */
describe('applyCallOverrides', () => {
  const base = () => ({
    standardParams: {} as Partial<Record<string, unknown>>,
    providerOptions: {} as ProviderOptions
  })

  it('returns the base unchanged when there are no overrides', () => {
    const input = { standardParams: { temperature: 0.2 }, providerOptions: { openai: { reasoningEffort: 'low' } } }
    const result = applyCallOverrides(input, undefined, makeModel())
    expect(result).toBe(input)
  })

  it('applies sampling overrides at highest precedence', () => {
    const overrides: CallOverrides = { temperature: 0.9, topP: 0.5, maxOutputTokens: 100, stopSequences: ['STOP'] }
    const result = applyCallOverrides(
      { standardParams: { temperature: 0.2 }, providerOptions: {} },
      overrides,
      makeModel()
    )
    expect(result.standardParams).toMatchObject({
      temperature: 0.9,
      topP: 0.5,
      maxOutputTokens: 100,
      stopSequences: ['STOP']
    })
  })

  it('drops topK for Gemini 3.x via filterStandardParams', () => {
    const result = applyCallOverrides(base(), { topK: 40, temperature: 0.5 }, makeModel({ id: 'gemini::gemini-3-pro' }))
    expect(result.standardParams.temperature).toBe(0.5)
    expect(result.standardParams).not.toHaveProperty('topK')
  })

  it('keeps topK for models that support it', () => {
    const result = applyCallOverrides(base(), { topK: 40 }, makeModel({ id: 'openai::gpt-4o' }))
    expect(result.standardParams.topK).toBe(40)
  })

  it('merges providerOptions per provider without clobbering other providers', () => {
    const result = applyCallOverrides(
      { standardParams: {}, providerOptions: { openai: { reasoningEffort: 'low' } } },
      { providerOptions: { anthropic: { thinking: { type: 'enabled' } } } },
      makeModel()
    )
    expect(result.providerOptions).toMatchObject({
      openai: { reasoningEffort: 'low' },
      anthropic: { thinking: { type: 'enabled' } }
    })
  })

  it('shallow-merges keys within the same provider (override wins)', () => {
    const result = applyCallOverrides(
      { standardParams: {}, providerOptions: { anthropic: { existing: 1, shared: 'base' } } },
      { providerOptions: { anthropic: { shared: 'override', added: 2 } } },
      makeModel()
    )
    expect(result.providerOptions.anthropic).toEqual({ existing: 1, shared: 'override', added: 2 })
  })
})

describe('applyResponsesInstructions', () => {
  const optionsWith = (providerOptions?: ProviderOptions): AgentOptions =>
    ({ maxRetries: 0, ...(providerOptions && { providerOptions }) }) as AgentOptions

  it('mirrors the system prompt into openai.instructions for Responses-endpoint models', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, 'YOU-ARE-REPRO-BOT', ENDPOINT_TYPE.OPENAI_RESPONSES)
    expect(options.providerOptions?.openai?.instructions).toBe('YOU-ARE-REPRO-BOT')
  })

  it('merges into an existing openai providerOptions block without clobbering siblings', () => {
    const options = optionsWith({ openai: { reasoningEffort: 'low' } })
    applyResponsesInstructions(options, 'SYS', ENDPOINT_TYPE.OPENAI_RESPONSES)
    expect(options.providerOptions?.openai).toMatchObject({ reasoningEffort: 'low', instructions: 'SYS' })
  })

  it('does not overwrite an instructions value the user already set', () => {
    const options = optionsWith({ openai: { instructions: 'USER-SET' } })
    applyResponsesInstructions(options, 'SYS', ENDPOINT_TYPE.OPENAI_RESPONSES)
    expect(options.providerOptions?.openai?.instructions).toBe('USER-SET')
  })

  it('does nothing for non-Responses endpoints (Chat Completions)', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, 'SYS', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(options.providerOptions).toBeUndefined()
  })

  it('does nothing when the endpoint is undefined', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, 'SYS', undefined)
    expect(options.providerOptions).toBeUndefined()
  })

  it('does nothing when there is no system prompt', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, undefined, ENDPOINT_TYPE.OPENAI_RESPONSES)
    expect(options.providerOptions).toBeUndefined()
  })
})

describe('composeStopWhen', () => {
  const cond = (): StopCondition<ToolSet> => () => false

  it('returns the assistant base unchanged when no feature contributes a condition', () => {
    const base = cond()
    expect(composeStopWhen(base, [])).toBe(base)
    expect(composeStopWhen(undefined, [])).toBeUndefined()
  })

  it('OR-s the assistant base with feature conditions', () => {
    const base = cond()
    const feature = cond()
    expect(composeStopWhen(base, [feature])).toEqual([base, feature])
  })

  it('falls back to the SDK default step cap when a feature contributes without an assistant base', async () => {
    const feature = cond()
    const result = composeStopWhen(undefined, [feature])

    expect(Array.isArray(result)).toBe(true)
    const conditions = result as StopCondition<ToolSet>[]
    expect(conditions).toHaveLength(2)
    expect(conditions[1]).toBe(feature)
    // The injected fallback caps the tool loop at the SDK default of 20 steps.
    expect(await conditions[0]({ steps: new Array(20) } as never)).toBe(true)
    expect(await conditions[0]({ steps: new Array(19) } as never)).toBe(false)
  })
})
