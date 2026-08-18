import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { ApiKeyEntry } from '@shared/data/types/provider'

export interface ApiKeysData {
  keys: ApiKeyEntry[]
}

export type PatchProvider = (updates: UpdateProviderDto) => Promise<unknown>
