/**
 * IPC bridge for Hermes tool progress events.
 *
 * Subscribes to the {@link customSSEEventBus} (emitted by the SSE-filtering
 * fetch when the Hermes API server sends `hermes.tool.progress` events) and
 * forwards them to all renderer windows via the `Hermes_ToolProgress` IPC
 * channel.
 *
 * Import this module once during app startup to activate the bridge.
 * The subscription is idempotent — re-importing is a no-op.
 *
 * Renderer code listens with:
 *   window.electron.ipcRenderer.on(IpcChannel.Hermes_ToolProgress, handler)
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { HermesToolProgressEvent } from '@shared/types/hermes'

import { type CustomSSEEvent, customSSEEventBus } from '../ai/utils/sseFilteringFetch'

const logger = loggerService.withContext('HermesIpcBridge')

let _initialized = false

/**
 * Start forwarding Hermes SSE events to renderers.
 * Safe to call multiple times — only the first call activates the listener.
 */
export function initHermesIpcBridge(): void {
  if (_initialized) return
  _initialized = true

  customSSEEventBus.on('hermes.tool.progress', (event: CustomSSEEvent) => {
    try {
      const payload: HermesToolProgressEvent = {
        tool: String(event.data.tool ?? ''),
        emoji: event.data.emoji ? String(event.data.emoji) : undefined,
        label: event.data.label ? String(event.data.label) : undefined,
        toolCallId: String(event.data.toolCallId ?? ''),
        status: (event.data.status as HermesToolProgressEvent['status']) ?? 'running'
      }

      application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.Hermes_ToolProgress, payload)
    } catch (err) {
      logger.warn('Failed to forward Hermes tool progress event', { err })
    }
  })

  logger.info('Hermes IPC bridge initialized — tool progress events will be forwarded to renderers')
}
