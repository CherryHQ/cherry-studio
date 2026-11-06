import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

/** Stream routing identity; runtime executions need no provider/model database row. */
export type ExecutionId = UniqueModelId | `runtime:${string}`

export function getProviderModelId(id: ExecutionId): UniqueModelId | undefined {
  return !id.startsWith('runtime:') && isUniqueModelId(id) ? id : undefined
}
