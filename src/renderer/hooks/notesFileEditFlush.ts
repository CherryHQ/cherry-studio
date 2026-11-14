import { useSyncExternalStore } from 'react'

import {
  areNotesEditsLockedForRelocation,
  subscribeNotesRelocationEditLock
} from '@renderer/services/notesEditCoordination'

export {
  areNotesEditsLockedForRelocation,
  flushAllNotesEdits,
  getNotesRelocationBarrierEpoch,
  hasPendingNotesImagePastes,
  lockNotesEditsForRelocation,
  registerNotesEditFlush,
  registerNotesEditPreFlush,
  releaseOneNotesRelocationEditLock,
  resetNotesEditFlushTrackingForTests,
  runStructuralNotesFilesystemWrite,
  subscribeNotesRelocationEditLock,
  trackPendingNotesImagePaste,
  unlockNotesEditsForRelocation,
  waitForPendingNotesImagePastes,
  waitForStructuralNotesWritesToSettle
} from '@renderer/services/notesEditCoordination'

export function useNotesEditsLockedForRelocation(): boolean {
  return useSyncExternalStore(
    subscribeNotesRelocationEditLock,
    areNotesEditsLockedForRelocation,
    areNotesEditsLockedForRelocation
  )
}
