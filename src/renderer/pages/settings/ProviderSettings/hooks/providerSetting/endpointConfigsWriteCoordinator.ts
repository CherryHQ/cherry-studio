import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'

type EndpointConfigsSnapshot = NonNullable<UpdateProviderDto['endpointConfigs']>

/**
 * Cross-component serialization for whole-snapshot `endpointConfigs` PATCHes.
 * The server replaces endpointConfigs wholesale on one serialized write, so
 * read-modify-write cycles from different components (ApiHost actions and the
 * request-configuration drawer) must not overlap: each cycle runs after the
 * previous one completed, and the shared snapshot hands the previous result
 * to the next cycle even before React re-renders with its echo.
 */
const writeTails = new Map<string, Promise<void>>()
const lastWritten = new Map<string, EndpointConfigsSnapshot>()

export function serializeEndpointConfigsWrite<T>(providerId: string, task: () => Promise<T>): Promise<T> {
  const tail = writeTails.get(providerId) ?? Promise.resolve()
  const run = tail.then(task, task)
  const next = run.then(
    () => undefined,
    () => undefined
  )
  writeTails.set(providerId, next)
  void next.finally(() => {
    if (writeTails.get(providerId) === next) writeTails.delete(providerId)
  })
  return run
}

export function getLastWrittenEndpointConfigs(providerId: string): EndpointConfigsSnapshot | undefined {
  return lastWritten.get(providerId)
}

export function setLastWrittenEndpointConfigs(providerId: string, configs: EndpointConfigsSnapshot): void {
  lastWritten.set(providerId, configs)
}

export function clearLastWrittenEndpointConfigs(providerId: string): void {
  lastWritten.delete(providerId)
}
