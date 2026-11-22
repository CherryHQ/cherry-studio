import { useMemo, useSyncExternalStore } from 'react'

import { fileObservationService, type FileObservationState } from '@renderer/services/fileObservation'
import type { AbsoluteFilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

const EMPTY: FileObservationState = { version: 0, coverage: 'starting', error: null }
const emptySnapshot = () => EMPTY
const emptySubscribe = () => () => {}
const whenUnavailable = async () => {
  throw new Error('No file observation target')
}

export function useFileObservation(
  path: AbsoluteFilePath | undefined
): FileObservationState & { whenReady: () => Promise<void>; refresh: () => Promise<void> } {
  const session = useMemo(() => (path ? fileObservationService.get(createFilePathHandle(path)) : undefined), [path])
  const state = useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.getSnapshot ?? emptySnapshot)
  return { ...state, whenReady: session?.whenReady ?? whenUnavailable, refresh: session?.refresh ?? whenUnavailable }
}
