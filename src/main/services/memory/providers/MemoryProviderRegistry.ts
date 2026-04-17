/**
 * MemoryProviderRegistry — maps MemoryProviderId to provider factory functions.
 *
 * Providers are lazy-loaded on first activation to avoid loading heavy
 * dependencies (e.g. @libsql/client, hindsight-client) until needed.
 * Each call to create() returns a fresh, uninitialised provider instance.
 */

import type { MemoryProviderId } from '@shared/memory'
import type { MemoryProvider } from '@shared/memory/provider'

import { NullProvider } from './NullProvider'

type ProviderFactory = () => MemoryProvider | Promise<MemoryProvider>

export class MemoryProviderRegistry {
  private readonly factories = new Map<MemoryProviderId, ProviderFactory>()

  constructor() {
    // NullProvider is always registered synchronously — no heavy imports.
    this.register('off', () => new NullProvider())
  }

  /** Register a provider factory. Called at startup or lazily on first need. */
  register(id: MemoryProviderId, factory: ProviderFactory): void {
    this.factories.set(id, factory)
  }

  /** Create a fresh provider instance for the given id. */
  async create(id: MemoryProviderId): Promise<MemoryProvider> {
    const factory = this.factories.get(id)
    if (!factory) {
      throw new Error(`No factory registered for memory provider '${id}'. Register it first.`)
    }
    return factory()
  }

  /** Whether a factory is registered for the given id. */
  has(id: MemoryProviderId): boolean {
    return this.factories.has(id)
  }

  /** All registered provider ids. */
  registeredIds(): MemoryProviderId[] {
    return Array.from(this.factories.keys())
  }
}

/** Singleton registry shared by MemoryService. */
export const memoryProviderRegistry = new MemoryProviderRegistry()
