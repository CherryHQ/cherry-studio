import type { SerializedError } from '@renderer/types/error'
import { classifyError } from '@renderer/utils/errorClassifier'
import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import type { CherryUIMessage } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

/**
 * Whether the latest assistant reply ended because a provider other than Cherry Cloud ran out of quota
 * (Cherry Cloud's own quota has a dedicated notice). `activeNodeId` selects the latest reply on a branched topic.
 */
export function endsWithProviderQuotaError(
  messages: readonly CherryUIMessage[],
  activeNodeId?: string | null
): boolean {
  const latest = activeNodeId ? messages.find((message) => message.id === activeNodeId) : messages.at(-1)
  if (latest?.role !== 'assistant') return false
  const data = latest.parts.findLast((part) => part.type === 'data-error')?.data
  if (!data) return false
  const error: SerializedError = {
    ...data,
    name: data.name ?? null,
    message: data.message ?? null,
    stack: data.stack ?? null
  }

  const { messageSnapshot, modelId } = latest.metadata ?? {}
  const providerId =
    messageSnapshot?.model?.provider ??
    (isUniqueModelId(modelId) ? parseUniqueModelId(modelId).providerId : undefined) ??
    (typeof error.providerId === 'string' ? error.providerId : undefined)
  if (!providerId || isManagedCherryCloudModel(providerId)) return false
  return classifyError(error, providerId).category === 'quota'
}
