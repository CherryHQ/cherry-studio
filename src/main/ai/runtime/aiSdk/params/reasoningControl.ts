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
  resolveReasoningInvocation
} from '../../../utils/reasoningSerializers'

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
      const options = merge({}, encodeReasoningInvocation(invocation), explicit)
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
        // SDK `reasoning` is input vocabulary only; the registry encoding above is the single wire source.
        reasoning: undefined,
        providerOptions: { ...params.providerOptions, [providerOptionsKey]: options },
        temperature: getTemperature(sampling, control.model, effective),
        topP: getTopP(sampling, control.model, effective),
        maxOutputTokens: adjustMaxOutputTokensForReasoning(params.maxOutputTokens, control.endpointType, effective)
      }
    }
  }
}
