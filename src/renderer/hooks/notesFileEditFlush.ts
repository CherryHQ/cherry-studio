import { useSyncExternalStore } from 'react'

import {
  areNotesEditsLockedForRelocation,
  subscribeNotesRelocationEditLock
} from '@renderer/services/notesEditCoordination'

export * from '@renderer/services/notesEditCoordination'

export function useNotesEditsLockedForRelocation(): boolean {
  return useSyncExternalStore(
    subscribeNotesRelocationEditLock,
    areNotesEditsLockedForRelocation,
    areNotesEditsLockedForRelocation
  )
}
