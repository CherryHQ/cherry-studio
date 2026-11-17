import type { FileHandle } from '@shared/data/types/file'

export function createMockFileObservationService() {
  const sessions = new Map<string, ReturnType<typeof createSession>>()
  function createSession() {
    let state = { version: 0, coverage: 'live' as const, error: null }
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => state,
      whenReady: async () => {},
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      invalidate: () => {
        state = { ...state, version: state.version + 1 }
        for (const listener of listeners) listener()
      }
    }
  }
  return {
    reset() {
      sessions.clear()
    },
    get(handle: FileHandle) {
      const key = JSON.stringify(handle)
      let session = sessions.get(key)
      if (!session) {
        session = createSession()
        sessions.set(key, session)
      }
      return session
    }
  }
}

export const mockFileObservationService = createMockFileObservationService()
