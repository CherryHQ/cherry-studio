import { useSyncExternalStore } from 'react'

import { ipcApi } from '@renderer/ipc'
import type { AppEdition } from '@shared/types/appEdition'

let edition: AppEdition | undefined
let ready: Promise<void> | undefined
const listeners = new Set<() => void>()

export function watchAppEdition(): Promise<void> {
  if (!ready) {
    ipcApi.on('app.edition_changed', (next) => {
      edition = next
      for (const listener of listeners) listener()
    })
    ready = ipcApi.request('app.edition.get').then((snapshot) => {
      // A region change received during bootstrap is newer than the initial snapshot.
      edition ??= snapshot
    })
  }
  return ready
}

export function getAppEdition(): AppEdition {
  return edition ?? __APP_EDITION__
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppEdition(): AppEdition {
  return useSyncExternalStore(subscribe, getAppEdition)
}
