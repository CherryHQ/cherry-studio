import { randomUUID } from 'node:crypto'

import dayjs from 'dayjs'
import { app, BrowserWindow } from 'electron'

import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { MediaKind } from '@main/services/mediaProtocol'
import type { ScreenshotChatEventSchemas } from '@shared/ipc/schemas/screenshotChat'
import type { WindowId } from '@shared/ipc/types'
import type { ScreenshotResultData } from '@shared/types/screenshot'

interface Delivery {
  windowId: WindowId
  mediaId: string
  bytes: Uint8Array
  payload: ScreenshotChatEventSchemas['chat.screenshot.attachment']
  outcome?: boolean
  settle?: (accepted: boolean) => void
}

/** Coordinates screenshot delivery; the capture service knows only its result consumer. */
@Injectable('ScreenshotChatService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ScreenshotOverlayService', 'WindowManager', 'MediaProtocolService'])
export class ScreenshotChatService extends BaseService {
  private targets = new Map<WindowId, string>()
  private lastWindowId: WindowId | null = null
  private deliveries = new Map<string, Delivery>()

  protected onInit(): void {
    const rememberWindow = (_event: Electron.Event, window: BrowserWindow) => {
      const id = application.get('WindowManager').getWindowId(window)
      if (id && this.targets.has(id)) this.lastWindowId = id
    }
    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyed(({ id }) => {
        this.targets.delete(id)
        if (this.lastWindowId === id) this.lastWindowId = null
        for (const delivery of this.deliveries.values()) {
          if (delivery.windowId === id) {
            delivery.outcome = false
            this.release(delivery)
          }
        }
      })
    )
    app.on('browser-window-focus', rememberWindow)
    this.registerDisposable(() => app.removeListener('browser-window-focus', rememberWindow))
  }

  protected onDestroy(): void {
    for (const delivery of this.deliveries.values()) this.release(delivery)
    this.targets.clear()
  }

  setTarget(windowId: WindowId, scopeKey: string | null): void {
    if (scopeKey === null) this.targets.delete(windowId)
    else {
      this.targets.set(windowId, scopeKey)
      const focused = BrowserWindow.getFocusedWindow()
      if (focused && application.get('WindowManager').getWindowId(focused) === windowId) this.lastWindowId = windowId
    }
  }

  async startCapture(sourceWindowId?: WindowId): Promise<void> {
    const manager = application.get('WindowManager')
    const focused = BrowserWindow.getFocusedWindow()
    const windowId = sourceWindowId ?? (focused ? manager.getWindowId(focused) : this.lastWindowId)
    const window = windowId && manager.getWindow(windowId)
    const scopeKey = windowId && this.targets.get(windowId)
    if (!windowId || !window || window.isDestroyed() || !scopeKey) {
      await application.get('ScreenshotOverlayService').startCapture(sourceWindowId)
      return
    }

    let delivery: Delivery | undefined
    await application.get('ScreenshotOverlayService').startCapture(sourceWindowId, {
      submit: async (result: ScreenshotResultData & { text: string }) => {
        if (window.isDestroyed() || (!delivery && this.targets.get(windowId) !== scopeKey)) {
          throw new Error('The capture chat is no longer available')
        }
        if (delivery?.outcome === false) {
          this.release(delivery)
          delivery = undefined
        }
        if (delivery?.settle) throw new Error('Screenshot delivery is already pending')
        if (
          delivery &&
          (delivery.payload.text !== result.text || !Buffer.from(delivery.bytes).equals(result.pngBytes))
        ) {
          throw new Error('Retry the original screenshot while its delivery is unconfirmed')
        }
        if (!delivery) {
          const media = application.get('MediaProtocolService')
          const bytes = Buffer.from(result.pngBytes)
          const mediaId = media.store(MediaKind.Image, bytes, 'image/png')
          delivery = {
            windowId,
            mediaId,
            bytes,
            payload: {
              deliveryId: randomUUID(),
              imageUrl: media.getUrl(MediaKind.Image, mediaId),
              name: `screenshot_${dayjs().format('YYYYMMDD_HHmmss')}.png`,
              size: result.pngBytes.byteLength,
              text: result.text,
              scopeKey
            }
          }
          this.deliveries.set(delivery.payload.deliveryId, delivery)
        }
        const current = delivery
        const accepted =
          current.outcome ??
          (await new Promise<boolean>((resolve, reject) => {
            const timer = setTimeout(() => {
              current.settle = undefined
              reject(new Error('Screenshot delivery has not been confirmed; retry without changing the content'))
            }, 10000)
            current.settle = (accepted) => {
              clearTimeout(timer)
              current.settle = undefined
              resolve(accepted)
            }
            try {
              application.get('IpcApiService').send(windowId, 'chat.screenshot.attachment', current.payload)
            } catch (error) {
              clearTimeout(timer)
              current.settle = undefined
              this.release(current)
              delivery = undefined
              reject(error)
            }
          }))
        this.release(current)
        delivery = undefined
        if (!accepted) throw new Error('The chat could not accept the complete screenshot and message')
        if (!window.isDestroyed()) {
          if (window.isMinimized()) window.restore()
          window.show()
          window.focus()
        }
      },
      dispose: () => {
        if (delivery) this.release(delivery)
        delivery = undefined
      }
    })
  }

  receiveResult(windowId: WindowId, deliveryId: string, accepted: boolean): void {
    const delivery = this.deliveries.get(deliveryId)
    if (!delivery || delivery.windowId !== windowId) return
    // The receiver owns a Blob before accepting, so release never invalidates its draft.
    delivery.outcome = accepted
    if (delivery.settle) delivery.settle(accepted)
    else this.release(delivery)
  }

  private release(delivery: Delivery): void {
    delivery.settle?.(false)
    this.deliveries.delete(delivery.payload.deliveryId)
    application.get('MediaProtocolService').remove(MediaKind.Image, delivery.mediaId)
  }
}
