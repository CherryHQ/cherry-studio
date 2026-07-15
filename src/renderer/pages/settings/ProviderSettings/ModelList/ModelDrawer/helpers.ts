import {
  deriveLegacyReasoningFields,
  REASONING_EFFORT_ORDER,
  type ReasoningControl,
  type ReasoningEffort
} from '@cherrystudio/provider-registry'
import type { RuntimeReasoning } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'

import type { ReasoningControlsDraft } from './ModelReasoningControlsFields'
import type {
  AddModelDrawerPrefill,
  ModelBasicFormState,
  ModelCapabilityToggle,
  ModelDrawerEndpointType
} from './types'

const TOGGLE_TO_CAPABILITY: Record<ModelCapabilityToggle, string> = {
  [MODEL_CAPABILITY.IMAGE_RECOGNITION]: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  [MODEL_CAPABILITY.REASONING]: MODEL_CAPABILITY.REASONING,
  [MODEL_CAPABILITY.FUNCTION_CALL]: MODEL_CAPABILITY.FUNCTION_CALL,
  [MODEL_CAPABILITY.WEB_SEARCH]: MODEL_CAPABILITY.WEB_SEARCH,
  [MODEL_CAPABILITY.EMBEDDING]: MODEL_CAPABILITY.EMBEDDING,
  [MODEL_CAPABILITY.RERANK]: MODEL_CAPABILITY.RERANK
}

const CAPABILITY_TO_TOGGLE: Record<string, ModelCapabilityToggle> = Object.fromEntries(
  Object.entries(TOGGLE_TO_CAPABILITY).map(([key, value]) => [value, key as ModelCapabilityToggle])
) as Record<string, ModelCapabilityToggle>

export const MODEL_DRAWER_CURRENCY_SYMBOLS = ['$', '¥'] as const

export const MODEL_ENDPOINT_OPTIONS = [
  { id: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, label: 'endpoint_type.openai' },
  { id: ENDPOINT_TYPE.OPENAI_RESPONSES, label: 'endpoint_type.openai-response' },
  { id: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, label: 'endpoint_type.anthropic' },
  { id: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, label: 'endpoint_type.gemini' },
  { id: ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, label: 'endpoint_type.image-generation' },
  { id: ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, label: 'endpoint_type.image-edit' },
  { id: ENDPOINT_TYPE.JINA_RERANK, label: 'endpoint_type.jina-rerank' }
] as const

export function getModelApiId(model: Model): string {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

function resolveInitialEndpointTypes(
  prefill: AddModelDrawerPrefill | null | undefined,
  defaultEndpointType: ModelDrawerEndpointType
): ModelDrawerEndpointType[] {
  if (prefill?.endpointTypes?.length) {
    return [...prefill.endpointTypes]
  }
  if (prefill?.model?.endpointTypes?.length) {
    return [...prefill.model.endpointTypes]
  }
  if (prefill?.endpointType) {
    return [prefill.endpointType]
  }
  return [defaultEndpointType]
}

export function getInitialAddModelFormState(
  prefill: AddModelDrawerPrefill | null | undefined,
  defaultEndpointType: ModelDrawerEndpointType = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
): ModelBasicFormState {
  return {
    modelId: prefill?.model ? getModelApiId(prefill.model) : '',
    name: prefill?.model?.name ?? '',
    group: prefill?.model?.group ?? '',
    contextWindow: prefill?.model?.contextWindow != null ? String(prefill.model.contextWindow) : '',
    maxInputTokens: prefill?.model?.maxInputTokens != null ? String(prefill.model.maxInputTokens) : '',
    maxOutputTokens: prefill?.model?.maxOutputTokens != null ? String(prefill.model.maxOutputTokens) : '',
    endpointTypes: resolveInitialEndpointTypes(prefill, defaultEndpointType)
  }
}

export function splitModelIds(rawModelId: string): string[] {
  return rawModelId
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function readCurrency(model: Model): string {
  return model.pricing?.input?.currency ?? model.pricing?.output?.currency ?? '$'
}

export function capsToToggleSet(capabilities: string[]): Set<ModelCapabilityToggle> {
  const selected = new Set<ModelCapabilityToggle>()

  for (const capability of capabilities) {
    const toggle = CAPABILITY_TO_TOGGLE[capability]
    if (toggle) {
      selected.add(toggle)
    }
  }

  return selected
}

export function toggleSetToCaps(original: string[], selected: Set<ModelCapabilityToggle>): string[] {
  const toggleCapabilities = new Set(Object.values(TOGGLE_TO_CAPABILITY))
  const next = original.filter((capability) => !toggleCapabilities.has(capability))

  for (const toggle of selected) {
    next.push(TOGGLE_TO_CAPABILITY[toggle])
  }

  return next
}

export function getInitialSelectedCapabilities(model: Model): Set<ModelCapabilityToggle> {
  return capsToToggleSet(model.capabilities ?? [])
}

/**
 * Hydrate the reasoning-controls draft from a model descriptor (#16598).
 * Controls win; a legacy descriptor without controls pre-selects its
 * supportedEfforts as the effort vocabulary.
 */
export function reasoningToDraft(reasoning: Model['reasoning']): ReasoningControlsDraft {
  const controls = reasoning?.controls
  if (controls?.length) {
    const effort = controls.find((c) => c.kind === 'effort')
    const budget = controls.find((c) => c.kind === 'budget')
    return {
      effortValues: new Set(effort?.values ?? []),
      toggle: controls.some((c) => c.kind === 'toggle'),
      budgetEnabled: budget !== undefined,
      budgetMin: budget ? String(budget.min) : '',
      budgetMax: budget ? String(budget.max) : ''
    }
  }
  const legacyEfforts = (reasoning?.supportedEfforts ?? []).filter((v): v is ReasoningEffort =>
    (REASONING_EFFORT_ORDER as readonly string[]).includes(v)
  )
  const limits = reasoning?.thinkingTokenLimits
  return {
    effortValues: new Set(legacyEfforts),
    toggle: false,
    budgetEnabled: limits?.min != null && limits.max != null,
    budgetMin: limits?.min != null ? String(limits.min) : '',
    budgetMax: limits?.max != null ? String(limits.max) : ''
  }
}

/**
 * Convert the draft back to a full `RuntimeReasoning` for PATCH. Returns
 * `undefined` when no knob is declared (the patch then omits `reasoning`
 * entirely — clearing a stored descriptor is not supported by the DTO).
 * The wire dialect (`type`) is preserved from the existing descriptor; the
 * service re-resolves it from the provider when absent.
 */
export function draftToReasoning(
  draft: ReasoningControlsDraft,
  existing: Model['reasoning']
): RuntimeReasoning | undefined {
  const controls: ReasoningControl[] = []
  const effortValues = REASONING_EFFORT_ORDER.filter((v) => draft.effortValues.has(v))
  if (effortValues.length) controls.push({ kind: 'effort', values: effortValues })
  const min = Number(draft.budgetMin)
  const max = Number(draft.budgetMax)
  if (draft.budgetEnabled && Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max > 0 && min <= max) {
    controls.push({ kind: 'budget', min, max })
  }
  if (draft.toggle) controls.push({ kind: 'toggle' })
  if (!controls.length) return undefined
  const derived = deriveLegacyReasoningFields(controls)
  return {
    type: existing?.type ?? '',
    controls,
    supportedEfforts: derived.supportedEfforts ?? [],
    ...(derived.thinkingTokenLimits ? { thinkingTokenLimits: derived.thinkingTokenLimits } : {}),
    ...(derived.defaultEffort ? { defaultEffort: derived.defaultEffort } : {})
  }
}
