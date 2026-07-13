import { useCallback, useSyncExternalStore } from 'react'

/**
 * Renderer-local revision store for cursor-paged list resources.
 *
 * This module owns only the mechanism. Feature modules that expose a
 * cursor-paged list opt in via {@link registerDataApiCursorResource}; the
 * mutation/invalidation helpers in `useDataApi` consult the registry instead
 * of hardcoding endpoint knowledge into the generic layer.
 */

/** A concrete cursor-paged list path, e.g. '/topics'. */
export type DataApiCursorResource = string

type CursorResourceRegistration = {
  /** Sibling concrete paths a refresh of the resource must also touch (e.g. its /stats aggregate). */
  linkedRefreshPaths: readonly string[]
}

type RevisionListener = () => void

const registrations = new Map<DataApiCursorResource, CursorResourceRegistration>()
const listeners = new Map<DataApiCursorResource, Set<RevisionListener>>()
const revisions = new Map<DataApiCursorResource, number>()

const EMPTY_UNSUBSCRIBE = () => undefined

/**
 * Declare a resource as cursor-paged so local writes that refresh it restart
 * its cursor chains from page one. Call at module scope of the feature module
 * that owns the resource's list hooks — registration must run before any
 * mutation that refreshes the resource, and co-locating it with the hooks
 * guarantees that (no list can mount without loading its module).
 */
export function registerDataApiCursorResource(
  resource: DataApiCursorResource,
  options: { linkedRefreshPaths?: readonly string[] } = {}
): void {
  registrations.set(resource, { linkedRefreshPaths: options.linkedRefreshPaths ?? [] })
}

export function getRegisteredDataApiCursorResources(): DataApiCursorResource[] {
  return [...registrations.keys()]
}

export function getDataApiCursorLinkedRefreshPaths(resource: DataApiCursorResource): readonly string[] {
  return registrations.get(resource)?.linkedRefreshPaths ?? []
}

export function getDataApiCursorRevision(resource: DataApiCursorResource): number {
  return revisions.get(resource) ?? 0
}

export function publishDataApiCursorRevision(resource: DataApiCursorResource): void {
  revisions.set(resource, getDataApiCursorRevision(resource) + 1)
  for (const listener of listeners.get(resource) ?? []) listener()
}

function subscribeDataApiCursorRevision(resource: DataApiCursorResource, listener: RevisionListener): () => void {
  const resourceListeners = listeners.get(resource) ?? new Set<RevisionListener>()
  resourceListeners.add(listener)
  listeners.set(resource, resourceListeners)

  return () => {
    resourceListeners.delete(listener)
    if (resourceListeners.size === 0) listeners.delete(resource)
  }
}

/** Reads a Renderer-local cursor revision. No IPC or cross-window synchronization is involved. */
export function useDataApiCursorRevision(resource?: DataApiCursorResource): number {
  const subscribe = useCallback(
    (listener: () => void) => (resource ? subscribeDataApiCursorRevision(resource, listener) : EMPTY_UNSUBSCRIBE),
    [resource]
  )
  const getSnapshot = useCallback(() => (resource ? getDataApiCursorRevision(resource) : 0), [resource])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
