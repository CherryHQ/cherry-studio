import type { IpcEventName } from '@shared/ipc/schemas'
import type { EventPayload } from '@shared/ipc/types'
import { useEffect, useEffectEvent } from 'react'

import { ipcApi } from '.'

/**
 * React hook version of `ipcApi.on`: subscribes to a typed IpcApi event and
 * unsubscribes automatically on unmount, collapsing the legacy "manual
 * `removeListener` in a `useEffect` cleanup" boilerplate.
 *
 * The handler is wrapped with `useEffectEvent` so its identity may change between
 * renders without tearing down and re-creating the subscription — only `event` is an
 * effect dependency. Subscription goes through the typed `ipcApi.on` facade, so the
 * `window.api` access and the payload typing live in exactly one place.
 */
export function useIpcOn<E extends IpcEventName>(event: E, handler: (payload: EventPayload<E>) => void): void {
  const onEvent = useEffectEvent(handler)
  useEffect(() => {
    return ipcApi.on(event, onEvent)
    // `onEvent` is an Effect Event — useEffectEvent returns a fresh reference every
    // render, so it MUST be excluded from deps; only `event` should re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])
}
