import { getModelCapabilities as getAnthropicModelCapabilities } from '@ai-sdk/anthropic/internal'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { get, merge } from 'es-toolkit/compat'

import {
  REASONING_WIRE_TARGETS,
  type ReasoningWireProfile,
  type ReasoningWireTarget
} from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import type { AppProviderId } from '../../../types'
import { adjustMaxOutputTokensForReasoning, getTemperature, getTopP } from '../../../utils/modelParameters'
import {
  encodeReasoningInvocation,
  normalizeRequestedSelection,
  type ResolvedReasoningInvocation,
  resolveReasoningInvocation
} from '../../../utils/reasoningSerializers'

type SdkReasoning = NonNullable<LanguageModelV4CallOptions['reasoning']>

const DISPLAY_TARGETS = new Set<ReasoningWireTarget>([
  'reasoningSummary',
  'reasoning.exclude',
  'thinking.display',
  'sendReasoning',
  'thinkingConfig.includeThoughts',
  'extra_body.google.thinking_config.include_thoughts',
  'incremental_output'
])
const CONTROL_TARGETS = REASONING_WIRE_TARGETS.filter((target) => !DISPLAY_TARGETS.has(target))
const SDK_EFFORTS = new Set<string>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const EFFORT_ADAPTERS = new Set<AppProviderId>([
  'openai',
  'openai-chat',
  'azure',
  'azure-responses',
  'openai-compatible',
  'open-responses',
  'xai',
  'xai-responses'
])

export interface ReasoningControl {
  model: Model
  profile: ReasoningWireProfile
  providerId: AppProviderId
  providerOptionsKey: string
  endpointType: EndpointType | undefined
  enabled: boolean
  selection: ReasoningEffortOption
  summary?: string | null
}

export function resolveCallReasoning(control: ReasoningControl, params: LanguageModelV4CallOptions) {
  const requested = params.reasoning === 'provider-default' ? 'default' : (params.reasoning ?? control.selection)
  return resolveReasoningInvocation({
    selection: normalizeRequestedSelection(requested, control.model),
    model: control.model,
    profile: control.enabled || params.reasoning !== undefined ? control.profile : { disabled: true },
    maxTokens: params.maxOutputTokens ?? control.model.maxOutputTokens,
    assistantSummary: control.summary
  })
}

/** Replace only controls whose SDK translation preserves the registry's wire contract. */
function projectSdkReasoning(
  control: ReasoningControl,
  invocation: ResolvedReasoningInvocation,
  sdkModelId: string
): { reasoning?: SdkReasoning; options: Record<string, unknown> } {
  const options = encodeReasoningInvocation(invocation)
  const controls = invocation.emissions.filter(({ target }) => !DISPLAY_TARGETS.has(target))
  if (invocation.budgetTokens !== undefined) return { options }

  const effort = options.reasoningEffort
  if (controls.length === 1 && typeof effort === 'string' && SDK_EFFORTS.has(effort)) {
    const coercesMinimal = ['open-responses', 'xai', 'xai-responses'].includes(control.providerId)
    const coercesXhigh = ['xai', 'xai-responses'].includes(control.providerId)
    if (
      EFFORT_ADAPTERS.has(control.providerId) &&
      !(effort === 'minimal' && coercesMinimal) &&
      !(effort === 'xhigh' && coercesXhigh)
    ) {
      delete options.reasoningEffort
      return { reasoning: effort as SdkReasoning, options }
    }
  }

  if (
    control.providerId === 'anthropic' &&
    getAnthropicModelCapabilities(sdkModelId).supportsAdaptiveThinking &&
    get(options, 'thinking.type') === 'adaptive' &&
    (['low', 'medium', 'high'].includes(String(options.effort)) ||
      (options.effort === 'xhigh' && getAnthropicModelCapabilities(sdkModelId).supportsXhighEffort)) &&
    controls.every(({ target }) => target === 'thinking.type' || target === 'effort')
  ) {
    const reasoning = options.effort as SdkReasoning
    delete options.effort
    return { reasoning, options }
  }
  // Google's generation-dependent translation cannot infer the registry contract from a deployment alias.
  if (control.model.presetModelId !== sdkModelId) return { options }
  const level = get(options, 'thinkingConfig.thinkingLevel')
  if (
    control.providerId === 'google' &&
    ['low', 'medium', 'high'].includes(String(level)) &&
    controls.every(({ target }) => target === 'thinkingConfig.thinkingLevel')
  ) {
    delete (options.thinkingConfig as Record<string, unknown>).thinkingLevel
    return { reasoning: level as SdkReasoning, options }
  }
  return { options }
}

/** Resolve after SDK step-option merging; automatic native controls never enter the loop's base options. */
export function createReasoningMiddleware(control: ReasoningControl): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params, model }) => {
      const invocation = resolveCallReasoning(control, params)
      let providerOptionsKey = control.providerOptionsKey
      const namespaces = params.providerOptions ?? {}
      let explicit = namespaces[providerOptionsKey] ?? {}
      if (providerOptionsKey === 'anthropic' || providerOptionsKey === 'googleVertex') {
        providerOptionsKey = model.provider.split('.')[0]
        explicit = { ...namespaces.anthropic, ...explicit, ...namespaces[providerOptionsKey] }
      } else if (providerOptionsKey === 'openai' && model.provider.startsWith('azure.') && namespaces.azure) {
        providerOptionsKey = 'azure'
        explicit = namespaces.azure
      } else if (control.providerId === 'google-vertex' && namespaces.googleVertex) {
        providerOptionsKey = 'googleVertex'
        explicit = namespaces.googleVertex
      }
      const hasNativeControl = CONTROL_TARGETS.some((target) => get(explicit, target) !== undefined)
      const projected = hasNativeControl
        ? {
            options: encodeReasoningInvocation(invocation),
            reasoning: undefined
          }
        : projectSdkReasoning(control, invocation, model.modelId)
      const options = merge({}, projected.options, explicit)
      if (control.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES && control.providerOptionsKey === 'openai') {
        // OpenAI SDK otherwise invents a summary even on endpoints whose registry contract omits it.
        if (options.reasoningSummary === undefined) options.reasoningSummary = null
      }
      const thinkingType = get(options, 'thinking.type')
      if (thinkingType !== undefined && thinkingType !== 'adaptive' && explicit.effort === undefined) {
        delete options.effort
      }
      if (thinkingType !== 'enabled' && get(explicit, 'thinking.budgetTokens') === undefined && options.thinking) {
        delete (options.thinking as Record<string, unknown>).budgetTokens
      }
      const budgetTokens = thinkingType === 'enabled' ? get(options, 'thinking.budgetTokens') : undefined
      const offControls = control.profile.off?.operations.filter(({ target }) => !DISPLAY_TARGETS.has(target)) ?? []
      const nativeOff =
        thinkingType === 'disabled' ||
        thinkingType === 'between_tools' ||
        (offControls.length > 0 &&
          offControls.every(({ target, value }) => value.source === 'literal' && get(options, target) === value.value))
      const effective = {
        kind: hasNativeControl ? (nativeOff ? ('off' as const) : ('effort' as const)) : invocation.kind,
        budgetTokens: typeof budgetTokens === 'number' ? budgetTokens : undefined
      }
      const sampling = {
        enableTemperature: params.temperature !== undefined,
        temperature: params.temperature ?? 0,
        enableTopP: params.topP !== undefined,
        topP: params.topP ?? 1
      }
      return {
        ...params,
        reasoning: projected.reasoning,
        providerOptions: { ...params.providerOptions, [providerOptionsKey]: options },
        temperature: getTemperature(sampling, control.model, effective),
        topP: getTopP(sampling, control.model, effective),
        maxOutputTokens: adjustMaxOutputTokensForReasoning(params.maxOutputTokens, control.endpointType, effective)
      }
    }
  }
}
