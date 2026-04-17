/**
 * NullProvider — no-op memory provider used when feature.memory.provider = 'off'.
 * Every operation throws a typed error so callers can detect the disabled state.
 */

import type {
  AddMemoryOptions,
  MemoryDeleteAllOptions,
  MemoryItem,
  MemoryListOptions,
  MemoryProviderCapabilities,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryUser
} from '@shared/memory'
import type { MemoryProvider } from '@shared/memory/provider'

const DISABLED_ERROR = 'Memory provider is disabled. Enable memory in Settings → Memory.'

export class NullProvider implements MemoryProvider {
  readonly id = 'off'

  readonly capabilities: MemoryProviderCapabilities = {
    supportsReflect: false,
    supportsMentalModels: false,
    supportsBanks: false,
    serverSideExtraction: false
  }

  async init(): Promise<void> {}

  async add(_content: string | string[], _options?: AddMemoryOptions): Promise<MemoryItem[]> {
    throw new Error(DISABLED_ERROR)
  }

  async search(_query: string, _options?: MemorySearchOptions): Promise<MemorySearchResult> {
    throw new Error(DISABLED_ERROR)
  }

  async list(_options?: MemoryListOptions): Promise<MemoryItem[]> {
    throw new Error(DISABLED_ERROR)
  }

  async get(_id: string): Promise<MemoryItem | null> {
    throw new Error(DISABLED_ERROR)
  }

  async update(_id: string, _memory: string): Promise<MemoryItem> {
    throw new Error(DISABLED_ERROR)
  }

  async delete(_id: string): Promise<void> {
    throw new Error(DISABLED_ERROR)
  }

  async deleteAll(_options?: MemoryDeleteAllOptions): Promise<void> {
    throw new Error(DISABLED_ERROR)
  }

  async listUsers(): Promise<MemoryUser[]> {
    return []
  }

  async healthCheck(): Promise<boolean> {
    return false
  }
}
