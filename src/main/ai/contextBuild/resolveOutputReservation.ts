/**
 * How many tokens of the context window this request hands to the reply.
 *
 * Providers bill `input + max_tokens` against the window, so a request that
 * declares `max_tokens` has that much less room for its prompt. A request that
 * declares none reserves nothing: `buildAgentParams` deletes the field rather
 * than substituting a default, and the model simply generates into whatever the
 * prompt leaves behind. `undefined` therefore means "nothing is billed", not
 * "unknown" — see {@link resolveInputRoom}, which relies on that distinction.
 */
import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { providerService } from '@main/data/services/ProviderService'
import type { Assistant } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'

import { resolveEffectiveEndpoint } from '../provider/endpoint'

const logger = loggerService.withContext('ai:outputReservation')

/**
 * The `max_tokens` this request will put on the wire, or `undefined` when it
 * will send none. Precedence: explicit call override → custom parameter →
 * the assistant's own limit when enabled → the model's ceiling, but only on the
 * Anthropic endpoint, whose API requires the field.
 */
export function resolveRequestedMaxOutputTokens(
  requestMaxOutputTokens: number | undefined,
  customMaxOutputTokens: unknown,
  assistant: Assistant | undefined,
  model: Model,
  endpointType: EndpointType | undefined
): number | undefined {
  if (requestMaxOutputTokens !== undefined) return requestMaxOutputTokens
  if (typeof customMaxOutputTokens === 'number') return customMaxOutputTokens

  const enableMaxTokens = assistant?.settings.enableMaxTokens ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxTokens
  if (enableMaxTokens) return assistant?.settings.maxTokens ?? DEFAULT_ASSISTANT_SETTINGS.maxTokens

  return endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ? model.maxOutputTokens : undefined
}

/**
 * Reservation for a turn that may run against several models at once (the
 * multi-model compare path). Takes the LARGEST reservation while the caller
 * takes the smallest window, so the derived input room is conservative at both
 * ends. `undefined` only when no model would send `max_tokens`.
 *
 * Used by the durable compaction path, which runs before `buildAgentParams` and
 * so has to resolve the assistant and endpoint itself. Both lookups are
 * synchronous (better-sqlite3); a missing row degrades to "no reservation"
 * rather than failing the turn.
 */
export function resolveOutputReservation(
  assistantId: string | undefined,
  models: readonly Model[]
): number | undefined {
  const assistant = loadAssistant(assistantId)
  let largest: number | undefined
  for (const model of models) {
    const reservation = resolveRequestedMaxOutputTokens(undefined, undefined, assistant, model, endpointTypeOf(model))
    if (reservation !== undefined && (largest === undefined || reservation > largest)) largest = reservation
  }
  return largest
}

function loadAssistant(assistantId: string | undefined): Assistant | undefined {
  if (!assistantId) return undefined
  try {
    return assistantDataService.getById(assistantId)
  } catch {
    return undefined
  }
}

function endpointTypeOf(model: Model): EndpointType | undefined {
  try {
    return resolveEffectiveEndpoint(providerService.getByProviderId(model.providerId), model).endpointType
  } catch (error) {
    logger.warn('could not resolve endpoint for output reservation', { modelId: model.id, error })
    return undefined
  }
}
