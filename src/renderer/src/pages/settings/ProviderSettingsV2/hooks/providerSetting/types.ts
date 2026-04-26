import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export interface ApiKeysData {
  keys: Array<{ id: string; key: string; isEnabled: boolean }>
}

export type PatchProvider = (updates: UpdateProviderDto) => Promise<unknown>
export type SyncProviderModels = (provider: Provider) => Promise<Model[]>
