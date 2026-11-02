import { useEffect } from 'react'

import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { degradedFaultHostService } from '@renderer/services/DegradedFaultHostService'

const logger = loggerService.withContext('AppErrorRuntime')

function isResizeObserverNoise(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.includes('ResizeObserver loop')
}

/**
 * Uncaught errors become one deduplicated toast (or a handoff to the main window).
 * Logger calls are not an input. The detail module loads on the first real fault so
 * this listener does not pull schema or model code into window startup.
 */
export function AppErrorRuntime({ mode }: { readonly mode: 'main' | 'local' | 'handoff' | 'degraded' }) {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const error = event.error ?? event.message
      if (error === undefined || error === '' || isResizeObserverNoise(error)) return
      if (mode === 'degraded') {
        if (!degradedFaultHostService.presentDegradedFault(error)) logger.error('Degraded fault host is not registered')
        return
      }
      const delivery = mode === 'handoff' ? 'handoff' : 'local'
      void import('@renderer/services/AppErrorDetailService')
        .then(({ presentUncaught }) => presentUncaught(error, 'window.error', delivery))
        .catch((loadError) => logger.error('Failed to present a window error', loadError as Error))
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isResizeObserverNoise(event.reason)) return
      if (mode === 'degraded') {
        if (!degradedFaultHostService.presentDegradedFault(event.reason))
          logger.error('Degraded fault host is not registered')
        return
      }
      const delivery = mode === 'handoff' ? 'handoff' : 'local'
      void import('@renderer/services/AppErrorDetailService')
        .then(({ presentUncaught }) => presentUncaught(event.reason, 'window.unhandledrejection', delivery))
        .catch((loadError) => logger.error('Failed to present a window rejection', loadError as Error))
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [mode])

  // Migration's simplest preload exposes `window.electron` only. `useIpcOn` reads
  // `window.api.ipcApi` with no guard, so this receiver stays unmounted off main.
  return mode === 'main' ? <MainErrorReceiver /> : null
}

function MainErrorReceiver() {
  useIpcOn('app.error.open', (context) => {
    void import('@renderer/services/AppErrorDetailService')
      .then(({ presentHandedOffError }) => presentHandedOffError(context))
      .catch((loadError) => logger.error('Failed to present a handed-off error', loadError as Error))
  })

  useEffect(() => {
    void ipcApi.request('app.surface.receiver', { kind: 'error', ready: true }).catch((error) => {
      logger.error('Failed to register the main error receiver', error as Error)
    })
    return () => {
      void ipcApi.request('app.surface.receiver', { kind: 'error', ready: false }).catch(() => undefined)
    }
  }, [])

  return null
}
