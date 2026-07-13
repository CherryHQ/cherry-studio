import { useCallback, useSyncExternalStore } from 'react'

/** Cursor-backed resources that restart from page one after a local write. */
export const DATA_API_CURSOR_RESOURCES = ['/topics', '/agent-sessions'] as const
export type DataApiCursorResource = (typeof DATA_API_CURSOR_RESOURCES)[number]

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
