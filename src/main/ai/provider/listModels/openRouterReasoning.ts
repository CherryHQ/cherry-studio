/**
 * Translate OpenRouter's model-list reasoning metadata into the app's
 * provider-neutral runtime form.
 *
 * OpenRouter declares per-model support in two places:
 *  - `reasoning.supported_efforts` — the exact effort vocabulary the model accepts
 *    (plus `reasoning.default_effort`).
 *  - `supported_parameters` — the request parameters the model accepts. It is the
 *    only signal for models whose reasoning block has no explicit vocabulary.
 *
 * This runs while listing models, before the registry gives the model a preset
 * identity. The resulting `controls` are intrinsic, so the runtime path
 * (`ProviderRegistryService.projectRuntimeReasoning`) can re-project them through
 * whichever endpoint profile the provider actually uses.
 */
import {
  deriveLegacyReasoningFields,
  REASONING_EFFORT,
  REASONING_FORMAT_PROFILES
} from '@cherrystudio/provider-registry'
import type { ReasoningControl, ReasoningEffort } from '@cherrystudio/provider-registry'
import { projectRuntimeReasoning } from '@main/data/services/ProviderRegistryService'
import type { RuntimeReasoning } from '@shared/data/types/model'

const OPENAI_CHAT_WIRE = REASONING_FORMAT_PROFILES['openai-chat'].wire
const KNOWN_EFFORTS: ReadonlySet<string> = new Set(Object.values(REASONING_EFFORT))

/** Every effort the gateway accepts, in the catalog's own descending order — the vocabulary of an explicit `null`. */
const GATEWAY_EFFORTS: readonly ReasoningEffort[] = [
  REASONING_EFFORT.MAX,
  REASONING_EFFORT.XHIGH,
  REASONING_EFFORT.HIGH,
  REASONING_EFFORT.MEDIUM,
  REASONING_EFFORT.LOW,
  REASONING_EFFORT.MINIMAL,
  REASONING_EFFORT.NONE
]

/** OpenRouter's `reasoning_effort` parameter accepts the OpenAI-style tiers; the
 *  per-model `supported_efforts` list is what narrows this down when present. */
const REASONING_EFFORT_PARAMETER_TIERS = ['low', 'medium', 'high'] as const

export interface OpenRouterReasoningMetadata {
  reasoning?: {
    mandatory?: boolean | null
    supported_efforts?: string[] | null
    default_effort?: string | null
  } | null
  supported_parameters?: string[] | null
}

function normalizeEfforts(values: readonly string[] | null | undefined): ReasoningEffort[] {
  if (!values?.length) return []
  return Array.from(
    new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => KNOWN_EFFORTS.has(value)))
  ) as ReasoningEffort[]
}

function declaredEfforts(metadata: OpenRouterReasoningMetadata): ReasoningEffort[] {
  const published = metadata.reasoning?.supported_efforts
  // `null` is documented as "all gateway effort values are accepted"; an omitted
  // key means the model exposes no effort vocabulary at all.
  if (published === null) return [...GATEWAY_EFFORTS]
  const explicit = normalizeEfforts(published)
  if (explicit.length > 0) return explicit
  // A model that advertises the parameter but not a vocabulary still accepts the
  // standard tiers; offer those instead of dropping the control entirely.
  return metadata.supported_parameters?.includes('reasoning_effort') ? [...REASONING_EFFORT_PARAMETER_TIERS] : []
}

export function openRouterReasoningFromMetadata(metadata: OpenRouterReasoningMetadata): RuntimeReasoning | undefined {
  const mandatory = metadata.reasoning?.mandatory === true
  // A mandatory model rejects `effort: 'none'`, so it is not a value the control
  // may offer — drop it before the default is validated against the vocabulary.
  const values = declaredEfforts(metadata).filter((value) => !mandatory || value !== REASONING_EFFORT.NONE)
  if (values.length === 0) return undefined

  const declaredDefault = metadata.reasoning?.default_effort?.trim().toLowerCase()
  const defaultEffort =
    declaredDefault && (values as readonly string[]).includes(declaredDefault)
      ? (declaredDefault as ReasoningEffort)
      : undefined

  const controls: ReasoningControl[] = [
    { kind: 'effort', values, ...(defaultEffort ? { default: defaultEffort } : {}) },
    // `mandatory: false` means the provider accepts switching reasoning off
    // (`reasoning.effort: 'none'`); only then is an Off choice honest.
    ...(metadata.reasoning?.mandatory === false ? [{ kind: 'toggle' as const }] : [])
  ]

  return projectRuntimeReasoning({ controls, ...deriveLegacyReasoningFields(controls) }, OPENAI_CHAT_WIRE)
}
