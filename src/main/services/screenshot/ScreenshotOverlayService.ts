import { writeFileSync } from 'node:fs'

import dayjs from 'dayjs'
import { app, BrowserWindow, clipboard, dialog, type Display, nativeImage, screen } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { ocrModelPaths } from '@main/ai/inference/ocrModelPaths'
import { DIAGNOSTICS_ENABLED } from '@main/core/diagnostics'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDev, isMac, isWin } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { isLocalModelReady } from '@main/services/localModel'
import { MediaKind } from '@main/services/mediaProtocol'
import { cropPng } from '@main/utils/image'
import {
  getScreenCapturePermissionStatus,
  openScreenCaptureSettings,
  requestScreenCapturePermission,
  type ScreenCapturePermissionStatus
} from '@main/utils/screenCapturePermission'
import type { OcrRecognitionResult } from '@shared/ipc/schemas/screenshot'
import type { WindowId } from '@shared/ipc/types'
import type { DetectedWindow, ScreenshotInitData, ScreenshotResultData } from '@shared/types/screenshot'

import { captureAllMonitors, listMonitors } from './screenCapture'
import { type CaptureResult, type MonitorInfo, type RawWindowInfo, ScreenCapturePermissionError } from './types'
import { listWindowsOffThread } from './windowEnumerator'

const logger = loggerService.withContext('ScreenshotOverlayService')

/**
 * How long an overlay may stay invisible while waiting for its renderer to report
 * a painted first frame. Comfortably longer than decoding a full-screen PNG, so it
 * only ever fires for a renderer that is alive but unusually slow.
 */
const REVEAL_FALLBACK_MS = 1000

/**
 * Smallest snap target kept, per side, in DIP. Remote-desktop and monitor helper
 * tools register 1px edge-line windows spanning a whole screen edge; without this
 * every cursor move to an edge would snap the selection to a 1px strip.
 */
const MIN_SNAP_TARGET_SIZE = 5

/**
 * Chromium's net error for a navigation that was cancelled or superseded. It says
 * nothing about the renderer's health, so it must not tear the session down.
 */
const ERR_ABORTED = -3

/**
 * Capture-path timings for one session, in ms from the moment the shortcut landed.
 *
 * Only populated under `CS_DIAGNOSTICS`. Exists because the latency this path was
 * fixed for is invisible from the outside: "the overlay feels slow" cannot tell a
 * cold renderer apart from a blocked main process, and the two have opposite fixes.
 */
interface CaptureTrace {
  t0: number
  /** Screen capture and PNG encode, i.e. everything before the first open(). */
  captureMs: number
  /** All overlays opened and shown at opacity 0. */
  openMs: number
  /** Overlays whose window had to be created; the rest came warm from the pool. */
  created: number
  /** Overlays this session opened, i.e. how many readiness reports to expect. */
  expected: number
  ready: number
}

/** One display's frozen capture, kept for the session so region OCR can crop it. */
interface SessionCapture {
  buffer: Buffer
  /** Physical pixel dimensions — needed to clamp an incoming region to the image. */
  width: number
  height: number
}

/** An OCR request's rectangle, in the capture's own physical pixel space. */
interface OcrRegion {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Orchestrates an interactive capture session: freeze every display, hand each
 * frozen image to a full-screen overlay window, then turn the overlay's result
 * into a clipboard image or a file.
 *
 * The capture happens BEFORE any overlay exists, on purpose — a live transparent
 * overlay would photograph its own UI and would race whatever the user is trying
 * to capture.
 */
@Injectable('ScreenshotOverlayService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'MediaProtocolService', 'OcrInferenceService'])
export class ScreenshotOverlayService extends BaseService {
  /** Overlay window ids of the live session — one per display that matched a capture. */
  private overlayWindowIds: WindowId[] = []

  /** True from the moment a capture starts until every exit of {@link startCapture}. */
  private capturing = false

  /** Media protocol entries handed out this session; nothing else frees them. */
  private mediaIds: string[] = []

  /** Session captures keyed by the media id handed to the owning overlay. */
  private sessionCaptures = new Map<string, SessionCapture>()

  /** Which media id belongs to which overlay — the ownership check for handshakes. */
  private overlayMediaIds = new Map<WindowId, string>()

  /** The overlay the user is currently interacting with, at most one per session. */
  private activeOverlayWindowId: WindowId | null = null

  /** Pending reveal per overlay, with the fallback timer it races. Cleared together. */
  private pendingReveals = new Map<WindowId, { reveal: () => void; timer: NodeJS.Timeout }>()

  /** Monotonic session id; a callback carrying an older one must not act. */
  private sessionGeneration = 0

  /** Overlays whose renderer reported a painted frame. Gates the Escape rescue below. */
  private renderersReady = new Set<WindowId>()

  /**
   * Snap targets pushed before their overlay reported ready, kept for one repeat.
   *
   * The enumeration usually outlives the overlays, but not always — few windows or a
   * failed enumeration resolves it in microtasks. That push can miss: a cold renderer
   * has not subscribed yet, and a pooled one clears the previous session's targets on
   * new init data, which would wipe it. Either way hover-to-window snapping is gone
   * for the whole capture, silently, so the push is repeated at the ready handshake.
   */
  private pendingSnapTargets = new Map<WindowId, DetectedWindow[]>()

  /** Timings of the live session. Null unless CS_DIAGNOSTICS is set. */
  private trace: CaptureTrace | null = null

  /** Overlay windows created since the session started; the rest came from the pool. */
  private overlaysCreated = 0

  /** Token of the newest OCR request. At most one overlay is active, so "keep only
   *  the newest" is global — bucketing by window would let two chains run at once. */
  private latestOcrToken: symbol | null = null

  protected onInit(): void {
    const windowManager = application.get('WindowManager')
    this.registerDisposable(
      windowManager.onWindowCreatedByType(WindowType.Screenshot, ({ id, window }) => {
        // No declarative equivalent in WindowBehavior, and a macOS panel window can
        // still paint traffic lights over a frameless overlay.
        if (isMac) window.setWindowButtonVisibility(false)

        // Counts creations, so a trace can say whether the pool actually served this
        // session warm. Reset per session in startCapture; pool warmup bumps it too.
        this.overlaysCreated++

        // Attached here rather than after open(): a recycled window never re-enters
        // this callback, so per-session listeners would pile up and still miss reuses.
        const abortSession = (reason: string) => {
          // An idle pooled window dying has nothing to do with the live session.
          if (!this.isSessionOverlay(id)) return
          logger.error('Overlay renderer went away; aborting the capture session', new Error(reason))
          this.dismiss()
        }
        // A dead renderer cannot handle Esc either, so revealing it would leave a
        // full-screen, always-on-top window that swallows clicks and cannot be closed.
        window.webContents.on('render-process-gone', (_event, details) => abortSession(details.reason))
        window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
          // A subframe failure or a superseded navigation leaves a perfectly usable
          // overlay; only a failed main-frame load means there is no UI to interact with.
          if (!isMainFrame || code === ERR_ABORTED) return
          abortSession(`${code} ${description}`)
        })
        // Stuck in a loop: no crash event ever fires, and the reveal fallback would
        // happily show a window that cannot process the Esc it is about to receive.
        window.webContents.on('unresponsive', () => abortSession('unresponsive'))
        // Escape rescue for an overlay whose renderer never painted — the one state where
        // no renderer handler exists to press. Scoped to before-ready on purpose: once the
        // renderer owns Escape, stealing it here would cancel the whole capture instead of
        // the text annotation the user is typing.
        window.webContents.on('before-input-event', (_event, input) => {
          if (input.type !== 'keyDown' || input.key !== 'Escape') return
          if (!this.isSessionOverlay(id) || this.renderersReady.has(id)) return
          logger.warn('Escape closed an overlay whose renderer never reported ready', { windowId: id })
          this.dismiss()
        })
      })
    )

    const preferenceService = application.get('PreferenceService')
    this.syncPool(preferenceService.get('feature.screenshot.enabled'))
    this.registerDisposable(
      preferenceService.subscribeChange('feature.screenshot.enabled', (enabled) => {
        this.syncPool(enabled)
        // subscribeChange fires only on a real change, so this is the off→on transition.
        if (enabled) this.warmUpCapturePermission()
      })
    )
  }

  protected onDestroy(): void {
    this.dismiss()
  }

  /**
   * Freeze every display and open one overlay per display.
   *
   * Returns immediately when a capture is already running or a session is already on
   * screen, when the feature is off, or when screen recording is not granted (guiding
   * the user instead).
   */
  public async startCapture(): Promise<void> {
    // `capturing` carries the guard across the capture await, during which
    // `overlayWindowIds` is still empty and a second hotkey press would otherwise pass.
    if (this.capturing || this.overlayWindowIds.length > 0) return
    this.capturing = true

    try {
      const preferenceService = application.get('PreferenceService')
      if (!preferenceService.get('feature.screenshot.enabled')) return

      const status = getScreenCapturePermissionStatus()
      if (status !== 'authorized') {
        void this.guideToPermission(status)
        return
      }

      // Advance only once a session is definitely starting: bumping it above the guards
      // would let a blocked second attempt freeze the FIRST session's overlays at opacity 0.
      const generation = ++this.sessionGeneration

      const t0 = performance.now()
      this.overlaysCreated = 0

      try {
        // Started before the capture so the enumeration — hundreds of milliseconds of
        // native work — overlaps the PNG encode and the window opening rather than
        // following them. It runs off the main thread; see listWindowsOffThread.
        const snapCandidates = collectSnapCandidates()

        const captures = await captureAllMonitors()
        const captureMs = performance.now() - t0
        const windowManager = application.get('WindowManager')
        const mediaProtocol = application.get('MediaProtocolService')
        const displays = screen.getAllDisplays()

        // Only the overlay under the cursor may take focus; letting all of them call
        // focus() makes the winner depend on event-loop scheduling.
        const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

        // Hoisted out of the loop: each call re-enumerates displays through the native
        // backend, which is a visible stall when repeated per display per capture.
        const monitorInfoList = listMonitors()
        // On Windows the native backend expresses every monitor origin in the PRIMARY
        // display's pixel grid, so its scale factor is the reference for normalizing.
        const primaryScaleFactor = screen.getPrimaryDisplay().scaleFactor

        const autoOcr = preferenceService.get('feature.screenshot.auto_ocr')
        const ocrAvailable = isLocalModelReady('ocr')

        // Which overlay covers which display, for the snap-target push below.
        const snapOverlays: { windowId: WindowId; display: Display }[] = []

        for (const display of displays) {
          const captureResult = matchCapture(display, captures, monitorInfoList, primaryScaleFactor)
          if (!captureResult) {
            logger.warn('No capture matched a display; it gets no overlay', {
              displayId: display.id,
              bounds: display.bounds,
              monitors: monitorInfoList.map((m) => ({ id: m.id, x: m.x, y: m.y, scaleFactor: m.scaleFactor }))
            })
            continue
          }

          // Store before open(): initData carries the media id.
          const mediaId = mediaProtocol.store(MediaKind.Image, captureResult.buffer, 'image/png')
          this.mediaIds.push(mediaId)
          this.sessionCaptures.set(mediaId, {
            buffer: captureResult.buffer,
            width: captureResult.width,
            height: captureResult.height
          })

          // Floored: DPI scaling makes Electron report values like 1919.9999…, and the
          // leftover fraction shows up as a 1px uncovered strip at a display edge.
          const bounds = {
            x: Math.floor(display.bounds.x),
            y: Math.floor(display.bounds.y),
            width: Math.floor(display.bounds.width),
            height: Math.floor(display.bounds.height)
          }

          // initData MUST travel through open(): only that path pushes it to a recycled
          // window, whose renderer never re-reads storage and would show the old capture.
          const windowId = windowManager.open<ScreenshotInitData>(WindowType.Screenshot, {
            options: bounds,
            initData: {
              imageUrl: mediaProtocol.getUrl(MediaKind.Image, mediaId),
              mediaId,
              display: {
                id: display.id,
                x: bounds.x,
                y: bounds.y,
                width: captureResult.width,
                height: captureResult.height,
                scaleFactor: display.scaleFactor
              },
              autoOcr,
              ocrAvailable
            }
          })

          const window = windowManager.getWindow(windowId)
          if (!window) {
            // open() already handed out this id; without closing it, the window never
            // returns to the pool and permanently occupies one of its recycle slots.
            windowManager.close(windowId)
            continue
          }

          this.overlayWindowIds.push(windowId)
          this.overlayMediaIds.set(windowId, mediaId)
          snapOverlays.push({ windowId, display })

          // Transparent first so the OS show animation is never visible.
          window.setOpacity(0)
          // macOS drops the fullscreen-auxiliary collection behavior on hide(). Reapply it
          // without joining every Space, so a stale capture cannot follow Space switches.
          if (isMac) {
            window.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true, skipTransformProcessType: true })
          }
          // showMode 'manual' means nothing else ever shows this window, and setOpacity()
          // on a hidden one is a no-op. Inactive: only the cursor's overlay takes focus.
          window.showInactive()
          // Windows clamps a window to the work area (taskbar excluded) at creation, so
          // re-assert the full display rect. Still invisible at opacity 0 here.
          window.setBounds(bounds)

          this.scheduleReveal(windowId, window, generation, display.id === cursorDisplay.id)
        }

        // Thrown into the catch below rather than returned: the user pressed a shortcut
        // and nothing appeared, which is a failed capture, not a quiet edge case.
        if (this.overlayWindowIds.length === 0) throw new Error('no display produced an overlay')

        if (DIAGNOSTICS_ENABLED) {
          this.trace = {
            t0,
            captureMs,
            openMs: performance.now() - t0,
            created: this.overlaysCreated,
            expected: this.overlayWindowIds.length,
            ready: 0
          }
        }

        void this.pushSnapTargets(generation, snapCandidates, snapOverlays, primaryScaleFactor)

        logger.info(`Screenshot session started with ${this.overlayWindowIds.length} overlay(s)`)
      } catch (error) {
        // dismiss(), not cleanup(): overlays already opened must come down too, or a
        // mid-loop failure strands full-screen always-on-top windows that nothing owns.
        this.dismiss()
        if (error instanceof ScreenCapturePermissionError) {
          void this.showPermissionDialog()
        } else {
          logger.error('Failed to start the screenshot session', error as Error)
          // The user pressed a shortcut and nothing happened; a log they never read
          // leaves "unsupported here" (Wayland, absent native binary) looking like a
          // broken app. The reason is included because it is the only clue they get.
          void this.showCaptureFailedDialog(error)
        }
      }
    } finally {
      // Cleared on every exit, or one failed attempt would kill the shortcut for good.
      this.capturing = false
    }
  }

  /** Whether the window belongs to the live session. */
  public isSessionOverlay(windowId: WindowId): boolean {
    return this.overlayWindowIds.includes(windowId)
  }

  /** Whether the window is the one the user is currently interacting with. */
  public isActiveOverlay(windowId: WindowId): boolean {
    return this.activeOverlayWindowId === windowId
  }

  /**
   * The calling overlay took over the interaction; the previously active one is
   * told to drop its selection, so at most one selection exists across displays.
   */
  public markOverlayActive(windowId: WindowId): void {
    if (windowId === this.activeOverlayWindowId) return

    if (this.activeOverlayWindowId) {
      application.get('IpcApiService').send(this.activeOverlayWindowId, 'screenshot.reset_overlay', undefined)
    }

    this.activeOverlayWindowId = windowId
  }

  /**
   * Make one overlay the keyboard target, without disturbing any selection.
   *
   * Only the cursor's display is focused at reveal time, so moving to another
   * display leaves its overlay unable to receive keys until it is clicked.
   * Deliberately separate from {@link markOverlayActive}, which resets the
   * previously active overlay — wrong for a plain hover.
   */
  public focusOverlay(windowId: WindowId): void {
    if (!this.isSessionOverlay(windowId)) return
    const window = application.get('WindowManager').getWindow(windowId)
    if (!window || window.isDestroyed()) return
    makeKeyWindow(window)
  }

  /**
   * Step this overlay below the IME candidate window while its text editor is open.
   *
   * macOS only: for a Chromium client the candidate window is placed at a fixed, low
   * level instead of above the client, so an overlay raised over the Dock and menu bar
   * covers it — text can be composed but the candidates are never visible. Stepping down
   * for the duration of the edit is the only lever available from this side; the Dock and
   * the menu bar do show over the frozen capture while it lasts.
   */
  public setTextEditing(windowId: WindowId, editing: boolean): void {
    if (!isMac) return
    application.get('WindowManager').behavior.setAlwaysOnTopLevel(windowId, editing ? 'floating' : null)
  }

  /**
   * Recognize text inside one region of an overlay's frozen capture.
   *
   * Serialization is `OcrInferenceService`'s own `PQueue({ concurrency: 1 })`; this only
   * has to make sure a superseded request produces nothing. The token is re-checked right
   * before the recognition and again after it, so a request overtaken while it waited for
   * its queue slot is dropped rather than painted over the newer result.
   */
  public async recognizeText(windowId: WindowId, mediaId: string, region: OcrRegion): Promise<OcrRecognitionResult> {
    const token = Symbol('ocr-request')
    this.latestOcrToken = token

    // Ownership, not just session membership: two overlays of one session would
    // otherwise let display A ask for OCR of display B's capture.
    if (this.overlayMediaIds.get(windowId) !== mediaId) return { status: 'rejected' }

    // Re-checked per request, never cached from initData: the user can delete the
    // model in settings while the overlay is open.
    if (!isLocalModelReady('ocr')) return { status: 'unavailable' }

    const capture = this.sessionCaptures.get(mediaId)
    if (!capture) return { status: 'rejected' }

    // An origin outside the image is a caller coordinate bug; clamping it would run a
    // full recognition on a 1px slice and report the result as "no text here".
    if (region.x >= capture.width || region.y >= capture.height) return { status: 'rejected' }

    // The renderer scales a CSS-px selection by scaleFactor and rounds, so the
    // rect can reach a pixel past the image edge.
    const clamped = {
      x: region.x,
      y: region.y,
      width: Math.min(region.width, capture.width - region.x),
      height: Math.min(region.height, capture.height - region.y)
    }
    if (clamped.width <= 0 || clamped.height <= 0) return { status: 'rejected' }

    try {
      const imageBytes = await cropPng(capture.buffer, clamped)

      // Superseded while the crop ran: skip a recognition whose result nobody will use.
      if (this.latestOcrToken !== token) return { status: 'rejected' }

      const result = await application
        .get('OcrInferenceService')
        .recognize(ocrModelPaths(), { kind: 'bytes', imageBytes })

      // A pooled overlay's React tree survives into the next session, so a late
      // success would paint the previous capture's text onto the new one.
      if (this.latestOcrToken !== token) return { status: 'rejected' }
      if (this.overlayMediaIds.get(windowId) !== mediaId) return { status: 'rejected' }

      return { status: 'ok', lines: result.lines }
    } catch (error) {
      // Rethrown so the overlay shows its error state; logged here because the IPC
      // transport only serializes the error to the renderer, it never records it.
      logger.error('Region OCR failed', error as Error)
      throw error
    }
  }

  /**
   * The calling overlay painted its first frame — reveal it.
   *
   * The media id must be the one this session handed that window: a recycled
   * overlay can report the previous session's frame before it has processed the
   * new init data, which would reveal a window still showing the old capture.
   */
  public markOverlayReady(windowId: WindowId, mediaId: string): void {
    if (this.overlayMediaIds.get(windowId) !== mediaId) return
    this.renderersReady.add(windowId)
    const targets = this.pendingSnapTargets.get(windowId)
    if (targets) {
      this.pendingSnapTargets.delete(windowId)
      application.get('IpcApiService').send(windowId, 'screenshot.snap_targets', { windows: targets })
    }
    this.pendingReveals.get(windowId)?.reveal()
    this.traceReady()
  }

  /**
   * Report the capture path's timings once every overlay has painted.
   *
   * `usable` is the number that matters: the shortcut is pressed at t0 and the user
   * can act at the last readiness report. `cold` tells whether the pool served this
   * session — a cold overlay and a blocked main process both look like "slow" from
   * the outside, and they have opposite fixes.
   */
  private traceReady(): void {
    const trace = this.trace
    if (!trace) return
    trace.ready++
    if (trace.ready < trace.expected) return
    this.trace = null

    const usable = performance.now() - trace.t0
    logger.info(
      `[Diagnostics/screenshot] usable=${usable.toFixed(0)}ms ` +
        `capture=${trace.captureMs.toFixed(0)}ms open=${(trace.openMs - trace.captureMs).toFixed(0)}ms ` +
        `paint=${(usable - trace.openMs).toFixed(0)}ms cold=${trace.created}/${trace.expected}`
    )
  }

  /**
   * Push each overlay the snap targets clipped to its own display.
   *
   * The list is pushed rather than carried in the init data because enumerating it
   * takes hundreds of milliseconds; waiting for it before opening the overlays put
   * it squarely on the shortcut's critical path. An overlay is fully usable before
   * it lands — hovering just snaps to the whole display until then.
   */
  private async pushSnapTargets(
    generation: number,
    candidates: Promise<RawWindowInfo[]>,
    overlays: { windowId: WindowId; display: Display }[],
    primaryScaleFactor: number
  ): Promise<void> {
    const startedAt = performance.now()
    const snapCandidates = await candidates
    // The session may have ended while the enumeration ran; a pooled overlay is only
    // hidden, so its renderer would happily apply targets for a capture it no longer shows.
    if (generation !== this.sessionGeneration) return

    if (DIAGNOSTICS_ENABLED) {
      logger.info(
        `[Diagnostics/screenshot] snap targets ready ${(performance.now() - startedAt).toFixed(0)}ms ` +
          `after the overlays opened (0ms means the enumeration finished first), ` +
          `${snapCandidates.length} candidates`
      )
    }

    const ipcApiService = application.get('IpcApiService')
    for (const { windowId, display } of overlays) {
      const windows = projectSnapCandidates(display, snapCandidates, primaryScaleFactor)
      ipcApiService.send(windowId, 'screenshot.snap_targets', { windows })
      // This push is best-effort: an overlay that has not reported ready may not have
      // subscribed yet, or may still clear it as stale. Repeat it once it has.
      if (!this.renderersReady.has(windowId)) this.pendingSnapTargets.set(windowId, windows)
    }
  }

  /** Copy the overlay's result to the clipboard and end the session. */
  public commit(result: ScreenshotResultData): void {
    try {
      const image = nativeImage.createFromBuffer(Buffer.from(result.pngBytes))
      // createFromBuffer never throws — undecodable input yields an EMPTY image, and
      // writing that wipes the clipboard while the log still claims success.
      if (image.isEmpty()) throw new Error('the result bytes could not be decoded')
      clipboard.writeImage(image)
      logger.info('Screenshot copied to the clipboard')
    } catch (error) {
      logger.error('Failed to copy the screenshot to the clipboard', error as Error)
    }

    // Outside the try: the overlays come down whether or not the clipboard took it.
    this.dismiss()
  }

  /**
   * Ask for a path and write the overlay's result there, then end the session.
   *
   * The dialog is opened differently per platform. On macOS, passing a parent
   * window renders it as a sheet, and a sheet is invisible on a transparent
   * frameless overlay — so every overlay is hidden, the app is activated, and a
   * standalone panel is shown instead. On Windows and Linux the opposite holds:
   * owning the dialog by the active overlay makes it modal to that window, which
   * blocks its input, renders above it regardless of z-level, and — the reason it
   * matters — opens on the display the user was actually selecting on.
   */
  public async save(result: ScreenshotResultData): Promise<void> {
    const generation = this.sessionGeneration
    try {
      const saveOptions: Electron.SaveDialogOptions = {
        // Local time, not an epoch: the name is what the user scans in a file list.
        defaultPath: `cherry_screenshot_${dayjs().format('YYYYMMDD_HHmmss')}.png`,
        filters: [{ name: t('dialog.png_image'), extensions: ['png'] }]
      }

      let dialogResult: Electron.SaveDialogReturnValue
      if (isMac) {
        this.hideAllOverlays()
        // `steal: true` is required, or the panel opens behind whatever application
        // was frontmost and the user faces a frozen screen with no visible dialog.
        app.focus({ steal: true })
        dialogResult = await dialog.showSaveDialog(saveOptions)
      } else {
        const parentWindow = this.findActiveOverlay()
        dialogResult = parentWindow
          ? await dialog.showSaveDialog(parentWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions)
      }

      if (dialogResult.canceled || !dialogResult.filePath) return

      // Nothing holds the session across the dialog: Esc on another display's overlay
      // ends it while the panel is open, and writing then saves a discarded capture.
      if (generation !== this.sessionGeneration) return

      try {
        // Decoded only to validate: undecodable input yields an EMPTY image, which used
        // to be written as a 0-byte .png. The renderer's own bytes are what lands on
        // disk, so the file is never round-tripped through another PNG encoder.
        if (nativeImage.createFromBuffer(Buffer.from(result.pngBytes)).isEmpty()) {
          throw new Error('the result bytes could not be decoded')
        }
        writeFileSync(dialogResult.filePath, result.pngBytes)
        logger.info('Screenshot saved to file')
      } catch (error) {
        // Logged, not rethrown: a failed write must not skip the teardown below.
        logger.error('Failed to save the screenshot', error as Error)
      }

      this.dismiss()

      if (isMac) {
        // app.focus({ steal: true }) left this app activated with nothing to show;
        // hand focus back to whatever the user was capturing.
        const hasVisibleWindows = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible())
        if (!hasVisibleWindows) app.hide()
      }
    } finally {
      // On cancel (or a throwing dialog) the overlays are hidden yet still tracked, so
      // the session would be stuck; after a successful save the list is empty, a no-op.
      if (isMac) this.showAllOverlays()
    }
  }

  /** Close every overlay and release the session's resources. */
  public dismiss(): void {
    const windowManager = application.get('WindowManager')
    const ipcApiService = application.get('IpcApiService')

    for (const windowId of this.overlayWindowIds) {
      // Sent before close(): a pooled window is only hidden, so its renderer would
      // otherwise hold the decoded capture and its canvas backing store — tens of MB
      // per display — until the next session pushes new init data or the pool decays.
      ipcApiService.send(windowId, 'screenshot.session_ended', undefined)
      // Opacity first: close() returns a pooled window to the pool rather than
      // destroying it, and a stale frame would flash on its next reuse.
      windowManager.getWindow(windowId)?.setOpacity(0)
      windowManager.close(windowId)
    }

    this.cleanup()
    logger.debug('Screenshot session dismissed')
  }

  /**
   * Arm the reveal for one overlay. The renderer handshake and the fallback timer
   * race: whichever lands first reveals the window and cancels the other.
   *
   * `ready-to-show` is deliberately not used — it fires as soon as Chromium paints,
   * which is long before the frozen image has been fetched, decoded and drawn.
   */
  private scheduleReveal(
    windowId: WindowId,
    window: BrowserWindow,
    generation: number,
    isCursorDisplay: boolean
  ): void {
    const reveal = () => {
      // Release resources BEFORE the staleness check: reversed, a stale call returns
      // early leaving the timer armed, which later warns falsely and leaks the entry.
      const entry = this.pendingReveals.get(windowId)
      if (entry) {
        clearTimeout(entry.timer)
        // Deleting the entry is what makes the reveal happen exactly once.
        this.pendingReveals.delete(windowId)
      }
      if (generation !== this.sessionGeneration) return
      if (window.isDestroyed()) return
      window.setOpacity(1)
      if (isCursorDisplay) makeKeyWindow(window)
    }

    const timer = setTimeout(() => {
      // A crashed renderer already went through dismiss(), which advanced the
      // generation — so this check also keeps the warning off that path.
      if (generation !== this.sessionGeneration) return
      logger.warn('Overlay revealed by the fallback timer; its renderer never reported ready', { windowId })
      reveal()
    }, REVEAL_FALLBACK_MS)

    this.pendingReveals.set(windowId, { reveal, timer })
  }

  /** Release every session resource. Pairs with, but is not a substitute for, closing the windows. */
  private cleanup(): void {
    // Makes any callback still in flight a no-op; it cannot make timers disappear,
    // which is what the loop below is for.
    this.sessionGeneration++
    for (const { timer } of this.pendingReveals.values()) clearTimeout(timer)
    this.pendingReveals.clear()

    const mediaProtocol = application.get('MediaProtocolService')
    // Media entries are never reclaimed automatically; one missed remove() pins a
    // full-screen PNG in memory for the rest of the process's life.
    for (const mediaId of this.mediaIds) mediaProtocol.remove(MediaKind.Image, mediaId)
    this.mediaIds = []
    this.sessionCaptures.clear()
    this.overlayMediaIds.clear()
    // Per-session: a recycled overlay that painted last time has to earn it again, or
    // the next session's never-painted window would have no Escape rescue.
    this.renderersReady.clear()
    this.pendingSnapTargets.clear()

    // Explicit, not left to pool release: an overlay whose session ended mid-edit would
    // otherwise come back at the text editor's level and never cover the Dock again.
    // Only macOS ever steps an overlay down (see setTextEditing), so only macOS restores.
    if (isMac) {
      const windowManager = application.get('WindowManager')
      for (const windowId of this.overlayWindowIds) windowManager.behavior.setAlwaysOnTopLevel(windowId, null)
    }

    this.overlayWindowIds = []
    this.activeOverlayWindowId = null
    if (DIAGNOSTICS_ENABLED && this.trace) {
      // Deliberately no usable= number: every overlay left here was revealed by the
      // fallback timer, so the only timestamp available is that timer's deadline —
      // reporting it would pass a constant off as a measurement.
      logger.info(
        `[Diagnostics/screenshot] capture trace incomplete: ` +
          `${this.trace.ready}/${this.trace.expected} overlays reported ready`
      )
    }
    this.trace = null

    // Invalidates every in-flight OCR result; the recognitions themselves run to completion.
    this.latestOcrToken = null
  }

  /** The overlay holding the live selection, used as the save dialog's parent. */
  private findActiveOverlay(): BrowserWindow | undefined {
    if (!this.activeOverlayWindowId) return undefined
    const window = application.get('WindowManager').getWindow(this.activeOverlayWindowId)
    return window && !window.isDestroyed() ? window : undefined
  }

  /** macOS save path: take every overlay out of the compositing stack. */
  private hideAllOverlays(): void {
    const windowManager = application.get('WindowManager')
    for (const windowId of this.overlayWindowIds) {
      const window = windowManager.getWindow(windowId)
      if (!window || window.isDestroyed()) continue
      window.setOpacity(0)
      // hide(), not opacity alone: an opacity-0 window stays in the stack at
      // screen-saver level, where it still covers the save panel.
      window.hide()
    }
  }

  /** macOS save path: bring the overlays back after the dialog closes. */
  private showAllOverlays(): void {
    const windowManager = application.get('WindowManager')
    for (const windowId of this.overlayWindowIds) {
      const window = windowManager.getWindow(windowId)
      if (!window || window.isDestroyed()) continue
      // Restore fullscreen coverage after hide() without making the stale capture
      // follow the user to another Space. The always-on-top level is restored by
      // the window type's reapplyAlwaysOnTop quirk.
      window.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true, skipTransformProcessType: true })
      window.setOpacity(0)
      // The active overlay must become the key window again or Esc and the next drag
      // land nowhere; the others stay unfocused, as at session start.
      if (windowId === this.activeOverlayWindowId) makeKeyWindow(window)
      else window.showInactive()
      // No handshake here: the image was decoded before the dialog opened.
      window.setOpacity(1)
    }
  }

  /**
   * Make macOS ask for screen-recording consent now, while the screen is untouched.
   *
   * Sequoia re-confirms consent every few weeks and raises the prompt on the app's next
   * ScreenCaptureKit call — display enumeration included — which is a separate gate from
   * the TCC entry `getScreenCapturePermissionStatus()` reads. Meeting it here keeps that
   * modal off the capture path, where the user faces it with overlays already opening.
   */
  private warmUpCapturePermission(): void {
    // Other platforms have nothing to confirm, and probing there would load the native
    // backend that this feature deliberately defers until a capture actually happens.
    if (!isMac) return

    // Deferred: the enumeration blocks until the user answers the prompt, and the
    // preference write that triggered it has to reach the settings UI first.
    setImmediate(() => {
      try {
        listMonitors()
      } catch (error) {
        // A convenience, not a user action — startCapture() still guides the user itself.
        logger.warn('Screen capture permission warm-up failed', error as Error)
      }
    })
  }

  /** Turning the feature off releases the warm overlay windows, not just the entry points. */
  private syncPool(enabled: boolean): void {
    const windowManager = application.get('WindowManager')
    if (enabled) windowManager.resumePool(WindowType.Screenshot)
    else windowManager.suspendPool(WindowType.Screenshot)
  }

  private async guideToPermission(status: ScreenCapturePermissionStatus): Promise<void> {
    if (status === 'not-determined') {
      await requestScreenCapturePermission()
      // In production the OS prompt owns the first ask, so a second dialog would be
      // redundant; a dev run gets no prompt at all and would appear to do nothing.
      if (!isDev) return
    }

    await this.showPermissionDialog()
  }

  private async showPermissionDialog(): Promise<void> {
    // The grant attaches to the running binary, which in development is the generic
    // Electron one — naming the product sends the user after a non-existent entry.
    const appName = isDev ? 'Electron' : app.getName()
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: t('dialog.screen_capture_permission.title'),
      message: t('dialog.screen_capture_permission.message'),
      detail: t('dialog.screen_capture_permission.detail', { appName }),
      buttons: [t('dialog.screen_capture_permission.open_settings'), t('dialog.screen_capture_permission.cancel')],
      defaultId: 0
    })

    if (response === 0) openScreenCaptureSettings()
  }

  /** Report a capture that failed for any reason other than a missing permission. */
  private async showCaptureFailedDialog(error: unknown): Promise<void> {
    await dialog.showMessageBox({
      type: 'error',
      title: t('dialog.screenshot_failed.title'),
      message: t('dialog.screenshot_failed.message'),
      detail: error instanceof Error ? error.message : String(error),
      buttons: [t('dialog.screenshot_failed.ok')],
      defaultId: 0
    })
  }
}

/**
 * Make an already-visible overlay the keyboard target.
 *
 * On macOS the overlay is a non-activating panel and a capture normally starts with
 * the app in the background, where `focus()` makes the panel key for an instant
 * before AppKit takes it back — leaving Esc and the next drag nowhere to land.
 * `show()` keeps it key, and skips app activation for a panel just as `focus()` does.
 */
function makeKeyWindow(window: BrowserWindow): void {
  if (isMac) window.show()
  else window.focus()
}

/**
 * Find the capture belonging to an Electron display.
 *
 * Electron and the native backend enumerate the same monitors under unrelated id
 * spaces and, on Windows, in different coordinate spaces, so the match degrades
 * through three tiers. Only origins are ever compared; sizes never participate.
 */
function matchCapture(
  display: Display,
  captures: Map<number, CaptureResult>,
  monitorInfoList: MonitorInfo[],
  primaryScaleFactor: number
): CaptureResult | undefined {
  // 1. Direct id match — exact on macOS, where both sides use CGDirectDisplayID.
  const byId = captures.get(display.id)
  if (byId) return byId

  for (const [monitorId, result] of captures) {
    const monitorInfo = monitorInfoList.find((m) => m.id === monitorId)
    if (!monitorInfo) continue

    // 2. Origin match with ±1 slack per axis, absorbing the native side's `as i32`
    //    truncation and Linux's rounding of fractional origins.
    if (Math.abs(monitorInfo.x - display.bounds.x) <= 1 && Math.abs(monitorInfo.y - display.bounds.y) <= 1) {
      return result
    }

    // 3. Windows HiDPI: the native side reports physical pixels in the primary
    //    display's grid while Electron reports DIP, so normalize before comparing.
    if (primaryScaleFactor !== 1) {
      const normX = Math.round(monitorInfo.x / primaryScaleFactor)
      const normY = Math.round(monitorInfo.y / primaryScaleFactor)
      if (Math.abs(normX - display.bounds.x) <= 1 && Math.abs(normY - display.bounds.y) <= 1) return result
    }
  }

  return undefined
}

/** The windows that may act as hover-to-snap targets, before any per-display work. */
async function collectSnapCandidates(): Promise<RawWindowInfo[]> {
  const selfPid = process.pid
  return (await listWindowsOffThread()).filter(
    (w) =>
      // Filters by pid, so every window of this app is excluded — the main window
      // and the launcher are just as wrong a snap target as an overlay.
      w.pid !== selfPid &&
      // A minimized window is not in the captured pixels, so snapping to its stale
      // bounds would highlight empty screen.
      !w.isMinimized &&
      // The Dock's invisible full-screen window would be the topmost hit everywhere.
      // Match on title (kCGWindowName): the owner name is localized and unusable.
      !(isMac && w.title === 'Dock')
  )
}

/**
 * Clip the snap candidates to one display and express them in that display's
 * overlay coordinate space (display-relative DIP).
 *
 * On Windows the native backend reports window rects in physical pixels, so the
 * overlap is computed there and converted afterwards; macOS and Linux already
 * report DIP, the same space as `display.bounds`.
 */
function projectSnapCandidates(
  display: Display,
  candidates: RawWindowInfo[],
  primaryScaleFactor: number
): DetectedWindow[] {
  const sf = display.scaleFactor
  // Deliberately asymmetric: on Windows a monitor's ORIGIN lives in the primary
  // display's pixel grid while its EXTENT scales by its own factor.
  const dx = isWin ? Math.round(display.bounds.x * primaryScaleFactor) : display.bounds.x
  const dy = isWin ? Math.round(display.bounds.y * primaryScaleFactor) : display.bounds.y
  const dw = isWin ? Math.round(display.bounds.width * sf) : display.bounds.width
  const dh = isWin ? Math.round(display.bounds.height * sf) : display.bounds.height

  const projected: DetectedWindow[] = []
  for (const w of candidates) {
    const overlapX = Math.max(w.x, dx)
    const overlapY = Math.max(w.y, dy)
    const overlapRight = Math.min(w.x + w.width, dx + dw)
    const overlapBottom = Math.min(w.y + w.height, dy + dh)

    // Strict comparison, so a zero-area touch between adjacent monitors is rejected.
    if (overlapRight <= overlapX || overlapBottom <= overlapY) continue

    let x = overlapX - dx
    let y = overlapY - dy
    let width = overlapRight - overlapX
    let height = overlapBottom - overlapY

    // Uses THIS display's factor, never the primary's — the renderer canvas is DIP.
    if (isWin && sf !== 1) {
      x = Math.round(x / sf)
      y = Math.round(y / sf)
      width = Math.round(width / sf)
      height = Math.round(height / sf)
    }

    // Deliberately after the conversion, making the threshold 5 DIP rather than
    // 5 physical pixels; reordering changes what gets dropped on HiDPI Windows.
    if (width < MIN_SNAP_TARGET_SIZE || height < MIN_SNAP_TARGET_SIZE) continue

    projected.push({ title: w.title, x, y, width, height })
  }

  return projected
}
