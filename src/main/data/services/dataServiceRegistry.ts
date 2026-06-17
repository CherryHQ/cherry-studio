/**
 * Lightweight service locator for the data-layer singletons.
 *
 * Why this exists: some data services call across each other in both directions
 * (e.g. MessageService <-> TopicService, ProviderService <-> ProviderRegistryService).
 * Importing the sibling singleton at module top-level forms a value-level import
 * cycle that the bundler cannot order, which previously had to be papered over with
 * `await import(...)` at call sites.
 *
 * Instead, services resolve siblings lazily through this registry at call time. The
 * registry never imports any service value (only `import type`), so it is always a
 * sink in the static graph and no cycle can form.
 *
 * Scope: only the services that participate in such a cycle are listed in
 * `DataServiceMap` and self-register here — every other data service stays a plain
 * direct-import singleton and never touches this registry. A participating service
 * registers itself at the bottom of its module via `registerDataService(...)`.
 * Registration therefore happens when the service module is first loaded. In
 * production every participating service is loaded by its own DataApi handler during
 * route registration, so all are registered before any business call runs. In tests,
 * ensure the sibling module is imported (a bare side-effect import is enough) so its
 * registration runs.
 */
import type { messageService } from './MessageService'
import type { providerRegistryService } from './ProviderRegistryService'
import type { providerService } from './ProviderService'
import type { topicService } from './TopicService'

interface DataServiceMap {
  MessageService: typeof messageService
  TopicService: typeof topicService
  ProviderService: typeof providerService
  ProviderRegistryService: typeof providerRegistryService
}

const registry = new Map<keyof DataServiceMap, unknown>()

export function registerDataService<K extends keyof DataServiceMap>(name: K, instance: DataServiceMap[K]): void {
  registry.set(name, instance)
}

export function getDataService<K extends keyof DataServiceMap>(name: K): DataServiceMap[K] {
  const instance = registry.get(name)
  if (!instance) {
    throw new Error(`Data service "${name}" is not registered yet`)
  }
  return instance as DataServiceMap[K]
}
