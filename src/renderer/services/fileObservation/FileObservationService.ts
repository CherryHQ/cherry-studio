import type { FileHandle } from '@shared/data/types/file'

import { FileObservationSession, type FileObservationState } from './FileObservationSession'

class FileObservationService {
  private readonly sessions = new Map<string, FileObservationSession>()

  get(handle: FileHandle): {
    getSnapshot: () => FileObservationState
    subscribe: (listener: () => void) => () => void
    whenReady: () => Promise<void>
  } {
    const key = JSON.stringify([handle.kind, handle.kind === 'path' ? handle.path : handle.entryId])
    const current = () => {
      let session = this.sessions.get(key)
      if (!session) {
        const created = new FileObservationSession(handle, () => {
          if (this.sessions.get(key) === created) this.sessions.delete(key)
        })
        session = created
        this.sessions.set(key, session)
      }
      return session
    }
    return {
      getSnapshot: () => current().getSnapshot(),
      subscribe: (listener) => current().subscribe(listener),
      whenReady: () => current().whenReady()
    }
  }
}

export const fileObservationService = new FileObservationService()
