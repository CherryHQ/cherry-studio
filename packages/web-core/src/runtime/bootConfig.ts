import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'

/**
 * Browser `data/bootConfig/BootConfigService`: the desktop keeps pre-lifecycle settings in a file
 * read before the database opens. The Worker has no such phase, so they live in memory over the
 * defaults for the session.
 */
export class BootConfigService {
  readonly #values: BootConfigSchema = structuredClone(DefaultBootConfig)

  get<K extends BootConfigKey>(key: K): BootConfigSchema[K] {
    return this.#values[key]
  }

  getAll(): BootConfigSchema {
    return { ...this.#values }
  }

  set<K extends BootConfigKey>(key: K, value: BootConfigSchema[K]): void {
    this.#values[key] = value
  }

  persist(): void {}
}

export const bootConfigService = new BootConfigService()
