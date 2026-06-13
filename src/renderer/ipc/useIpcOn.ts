import type { IpcEventName } from '@shared/ipc/schemas'
import type { EventPayload } from '@shared/ipc/types'
import { useEffect, useRef } from 'react'

/**
 * React hook version of `ipcApi.on`: subscribes to a typed IpcApi event and
 * unsubscribes automatically on unmount, collapsing the legacy "manual
 * `removeListener` in a `useEffect` cleanup" boilerplate.
 *
 * The handler is held in a ref so its identity may change between renders without
 * tearing down and re-creating the subscription — only `event` is an effect
 * dependency.
 */
export function useIpcOn<E extends IpcEventName>(event: E, handler: (payload: EventPayload<E>) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => window.api.ipcApi.on(event, (payload) => handlerRef.current(payload as EventPayload<E>)), [event])
}
