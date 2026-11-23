import { useSyncExternalStore } from 'react'

import { ipcApi } from '@renderer/ipc'
import type { AppEdition } from '@shared/types/appEdition'

let edition: AppEdition | undefined
const listeners = new Set<() => void>()

export function watchAppEdition(): void {
  if (window.api?.appEdition === undefined || edition) return
  edition = window.api.appEdition
  ipcApi.on('app.edition_changed', (next) => {
    edition = next
    for (const listener of listeners) listener()
  })
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
