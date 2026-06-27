import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { Provider } from '@shared/data/types/provider'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import type { StopCondition, ToolSet } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import { makeModel } from '../../../../__tests__/fixtures'
import { CherryRequestSource } from '../../../../requestSource'
import type { CallOverrides } from '../../../../types/requests'
import { applyCallOverrides, applyCherryinSourceHeaders, composeStopWhen } from '../buildAgentParams'
import type { SdkConfig } from '../scope'

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

describe('applyCherryinSourceHeaders', () => {
  const makeSdkConfig = (headers?: Record<string, string | undefined>): SdkConfig =>
    ({
      providerId: 'openai-compatible',
      providerSettings: headers ? { headers } : {},
      modelId: 'm'
    }) as unknown as SdkConfig
  const provider = (id: string): Provider => ({ id }) as unknown as Provider
  const headersOf = (sdkConfig: SdkConfig) =>
    (sdkConfig.providerSettings as { headers?: Record<string, string> }).headers

  // The provenance headers are gated on data-collection consent; default to granted
  // so each case exercises the cherryin/source logic, and revoke it explicitly below.
  beforeEach(() => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
  })

  it('stamps the source + conversation headers onto cherryin provider settings, preserving existing headers', () => {
    const sdkConfig = makeSdkConfig({ 'X-Title': 'Cherry Studio' })

    applyCherryinSourceHeaders(sdkConfig, provider('cherryin'), {
      feature: CherryRequestSource.Chat,
      conversationId: 'topic-1'
    })

    expect(headersOf(sdkConfig)).toEqual({
      'X-Title': 'Cherry Studio',
      'X-Cherry-Source': 'chat',
      'X-Cherry-Conversation-Id': 'topic-1'
    })
  })

  it('omits the conversation header for a stateless feature', () => {
    const sdkConfig = makeSdkConfig()

    applyCherryinSourceHeaders(sdkConfig, provider('cherryin'), { feature: CherryRequestSource.Knowledge })

    expect(headersOf(sdkConfig)).toEqual({ 'X-Cherry-Source': 'knowledge' })
  })

  it('leaves non-cherryin providers untouched', () => {
    const sdkConfig = makeSdkConfig({ 'X-Title': 'Cherry Studio' })

    applyCherryinSourceHeaders(sdkConfig, provider('openai'), {
      feature: CherryRequestSource.Chat,
      conversationId: 'topic-1'
    })

    expect(headersOf(sdkConfig)).toEqual({ 'X-Title': 'Cherry Studio' })
  })

  it('leaves cherryin untouched when data-collection consent is withheld', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    const sdkConfig = makeSdkConfig({ 'X-Title': 'Cherry Studio' })

    applyCherryinSourceHeaders(sdkConfig, provider('cherryin'), {
      feature: CherryRequestSource.Chat,
      conversationId: 'topic-1'
    })

    expect(headersOf(sdkConfig)).toEqual({ 'X-Title': 'Cherry Studio' })
  })

  it('is a no-op when the request carries no source', () => {
    const sdkConfig = makeSdkConfig({ 'X-Title': 'Cherry Studio' })

    applyCherryinSourceHeaders(sdkConfig, provider('cherryin'), undefined)

    expect(headersOf(sdkConfig)).toEqual({ 'X-Title': 'Cherry Studio' })
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
