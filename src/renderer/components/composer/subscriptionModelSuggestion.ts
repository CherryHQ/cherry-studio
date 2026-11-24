import { classifyError, type ErrorCategory, getLocalModelResolutionFailure } from '@renderer/utils/errorClassifier'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

/** Failures another provider's model can get past; request-shaped and local-tool failures would recur. */
const PROVIDER_SWITCH_CATEGORIES: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'auth',
  'permission',
  'region',
  'model',
  'quota',
  'rate_limit',
  'server',
  'deprecated'
])

/**
 * Whether the conversation's latest reply failed at a non-subscription provider in a way that
 * switching to a subscription model can fix. `partsByMessageId` holds live parts that may be
 * ahead of the persisted `message.parts`.
 */
export function shouldSuggestSubscriptionModel(
  messages: readonly CherryUIMessage[],
  partsByMessageId?: Readonly<Record<string, readonly CherryMessagePart[] | undefined>>
): boolean {
  const message = messages.at(-1)
  if (message?.role !== 'assistant' || message.metadata?.status !== 'error') return false

  const parts = partsByMessageId?.[message.id] ?? message.parts
  const errorPart = parts.findLast((part) => part.type === 'data-error')
  if (errorPart?.type !== 'data-error') return false

  const data = errorPart.data
  const error = { ...data, name: data.name ?? null, message: data.message ?? null, stack: data.stack ?? null }
  const { messageSnapshot, modelId } = message.metadata
  const providerId =
    messageSnapshot?.model?.provider ??
    (modelId && isUniqueModelId(modelId) ? parseUniqueModelId(modelId).providerId : undefined) ??
    (typeof data.providerId === 'string' ? data.providerId : undefined)
  if (!providerId || providerId === CHERRY_CLOUD_PROVIDER_ID) return false

  return (
    PROVIDER_SWITCH_CATEGORIES.has(classifyError(error, providerId).category) ||
    getLocalModelResolutionFailure(error) !== null
  )
}
