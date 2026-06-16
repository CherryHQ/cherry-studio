import { application } from '@application'
import { loggerService } from '@logger'
import { DIAGNOSTICS_ENABLED, SLOW_THRESHOLD_MS } from '@main/core/diagnostics'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcError, IpcErrorCode, type IpcResult } from '@shared/ipc/errors'
import { type IpcEventName, type IpcRequestSchemas, ipcRequestSchemas } from '@shared/ipc/schemas'
import type { EventPayload, IpcContext, WindowId } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'

import { ipcHandlers } from './handlers'
import { IpcRouter } from './IpcRouter'
import { validateSender } from './validateSender'

const logger = loggerService.withContext('IpcApiService')

/**
 * Transport coordinator for the IpcApi RPC channel — the command-side peer of
 * `DataApiService`, and like it a `BeforeReady` service so its handler is
 * registered before any window opens (the first window opens in
 * `MainWindowService.onReady`, a WhenReady step).
 *
 * It owns the single `IpcApi_Request` handler (router dispatch + source-trust
 * gate + structured error wrapping) and the `broadcast`/`send` event senders. All
 * business logic and resource lifecycles stay in the per-domain services this
 * delegates to; this class is pure transport plumbing.
 */
@Injectable('IpcApiService')
@ServicePhase(Phase.BeforeReady)
export class IpcApiService extends BaseService {
  private readonly router: IpcRouter<IpcRequestSchemas>

  constructor() {
    super()
    this.router = new IpcRouter(ipcRequestSchemas, ipcHandlers)
  }

  protected onInit(): void {
    // Native ipcMain.handle (not BaseService.ipcHandle sugar — that is deprecated, see ipc-migration-guide.md),
    // cleaned up via registerDisposable, mirroring DataApi's IpcAdapter.
    // Preload also forwards an optional trace `meta` 4th arg; it is ignored here until tracing is wired.
    ipcMain.handle(IpcChannel.IpcApi_Request, (event, route: string, input: unknown) =>
      this.handleRequest(event, route, input)
    )
    this.registerDisposable(() => ipcMain.removeHandler(IpcChannel.IpcApi_Request))
    logger.debug('IpcApi request channel registered')
  }

  private async handleRequest(event: IpcMainInvokeEvent, route: string, input: unknown): Promise<IpcResult<unknown>> {
    // Source-trust gate first: one channel funnels every capability, so verify the caller before the input.
    // `app.root` (the app's own bundle root) scopes which file:// frames count as the app's own renderer.
    if (!validateSender(event, application.getPath('app.root'))) {
      // Audit trail for probing against this single capability funnel. NOT throttled:
      // a flood needs an untrusted surface that can both reach the channel and fail
      // validateSender at high frequency, which is not reachable today. Revisit
      // (sample / aggregate by senderFrame.url) only if that scenario becomes real.
      logger.warn('Rejected IpcApi request from untrusted sender', {
        route,
        senderType: event.sender.getType(),
        senderUrl: event.senderFrame?.url
      })
      const error = new IpcError(
        IpcErrorCode.FORBIDDEN_SENDER,
        `Rejected IpcApi request from untrusted sender: ${route}`
      )
      return { ok: false, error: error.toJSON() }
    }

    const t0 = DIAGNOSTICS_ENABLED ? performance.now() : 0
    try {
      const data = await this.router.dispatch(route, input, this.makeContext(event))
      return { ok: true, data }
    } catch (e) {
      // Never throw to ipcMain.handle: Electron's reject drops code/data, so serialize into the result.
      return { ok: false, error: IpcError.from(e).toJSON() }
    } finally {
      if (DIAGNOSTICS_ENABLED) {
        const dt = performance.now() - t0
        if (dt > SLOW_THRESHOLD_MS.ipcHandler) logger.info(`[Diagnostics/ipc-api] ${dt.toFixed(1)}ms ${route}`)
      }
    }
  }

  /** Controlled context: only the caller's WindowId, never the raw WebContents/event. */
  private makeContext(event: IpcMainInvokeEvent): IpcContext {
    return { senderId: application.get('WindowManager').getWindowIdByWebContents(event.sender) ?? null }
  }

  /** Broadcast a typed event to every window. */
  broadcast<E extends IpcEventName>(event: E, payload: EventPayload<E>): void {
    application.get('WindowManager').broadcast(IpcChannel.IpcApi_Event, event, payload)
  }

  /**
   * Direct a typed event at one window; a no-op if that window is gone OR destroyed.
   *
   * `getWindow` reads the registry without filtering destroyed windows, and a window's
   * `destroy()` is synchronous while the `'closed'` handler that unregisters it runs a
   * tick later — so in that gap a bare `getWindow(id)?.webContents.send` would hit a
   * destroyed webContents and throw. The `isDestroyed()` guard closes that gap, matching
   * the "skips destroyed windows" contract of `WindowManager.broadcast` (so `send` and
   * `broadcast` give the same safety guarantee).
   */
  send<E extends IpcEventName>(windowId: WindowId, event: E, payload: EventPayload<E>): void {
    const window = application.get('WindowManager').getWindow(windowId)
    if (window && !window.isDestroyed()) {
      window.webContents.send(IpcChannel.IpcApi_Event, event, payload)
    }
  }
}
