import { createContext, use, useCallback, useSyncExternalStore } from 'react'

import type { ProjectionPartReader } from '@renderer/types/message'
import type { CherryMessagePart } from '@shared/data/types/message'

export const ProjectionPartContext = createContext<ProjectionPartReader | undefined>(undefined)

const identity = (part: CherryMessagePart | undefined) => part

export function useProjectionPartValue<T>(
  partId: string | undefined,
  fallback: CherryMessagePart | undefined,
  select: (part: CherryMessagePart | undefined) => T
): T {
  const reader = use(ProjectionPartContext)
  return useSyncExternalStore(
    useCallback((listener) => (partId && reader ? reader.subscribe(partId, listener) : () => {}), [reader, partId]),
    useCallback(
      () => select((partId && reader ? reader.read(partId) : undefined) ?? fallback),
      [reader, partId, fallback, select]
    )
  )
}
export function useProjectionPart(partId: string, fallback?: CherryMessagePart) {
  return useProjectionPartValue(partId, fallback, identity)
}
