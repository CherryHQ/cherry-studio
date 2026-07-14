import { useCallback, useSyncExternalStore } from 'react'

/**
 * Renderer-local revision store for cursor-paged list resources.
 *
 * This module owns only the mechanism. Mutation and invalidation call sites
 * publish revisions explicitly through `useDataApi`'s `reset-cursor` refresh
 * strategy; consumers subscribe with {@link useDataApiCursorRevision}.
 */

/** A concrete cursor-paged list path, e.g. '/topics'. */
export type DataApiCursorResource = string

type RevisionListener = () => void

const listeners = new Map<DataApiCursorResource, Set<RevisionListener>>()
const revisions = new Map<DataApiCursorResource, number>()

const EMPTY_UNSUBSCRIBE = () => undefined

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
