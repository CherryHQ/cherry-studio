import { EventEmitter } from 'node:events'
import type * as NodeFs from 'node:fs'

import { WindowType } from '@main/core/window/types'
import type { Display } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CaptureResult, RawWindowInfo } from '../types'

// ─── Mutable platform flags (macOS is this suite's default) ───────────────────

const platform = vi.hoisted(() => ({ isMac: true, isWin: false, isLinux: false, isDev: false }))
vi.mock('@main/core/platform', () => platform)

// ─── Capture engine, OCR readiness, i18n ──────────────────────────────────────

// Two mocks because the TCC gate lives outside this module: it answers for the whole
// process, and routing it through the barrel would pull this service into every launch.
const capture = vi.hoisted(() => ({
  captureAllMonitors: vi.fn(),
  listMonitors: vi.fn(),
  listWindows: vi.fn(),
  getScreenCapturePermissionStatus: vi.fn(),
  requestScreenCapturePermission: vi.fn(),
  openScreenCaptureSettings: vi.fn()
}))
vi.mock('../screenCapture', () => capture)
vi.mock('@main/utils/screenCapturePermission', () => capture)

const localModel = vi.hoisted(() => ({ isLocalModelReady: vi.fn(() => true) }))
vi.mock('@main/services/localModel', () => localModel)
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// ─── OCR pipeline ─────────────────────────────────────────────────────────────

vi.mock('@main/ai/inference/ocrModelPaths', () => ({
  ocrModelPaths: () => ({ detection: 'det', recognition: 'rec', charactersDictionary: 'dict' })
}))

// Tags the crop with the region's x so a test can tell which request reached the
// inference service; the real one would need decodable PNG bytes.
vi.mock('@main/utils/image', () => ({
  cropPng: vi.fn(async (_bytes: Uint8Array, region: { x: number }) => new Uint8Array([region.x]))
}))

// ─── Electron ─────────────────────────────────────────────────────────────────

const electron = vi.hoisted(() => ({
  displays: [] as unknown[],
  cursorDisplay: undefined as unknown,
  primaryDisplay: undefined as unknown,
  app: { getName: vi.fn(() => 'Product'), focus: vi.fn(), hide: vi.fn() },
  browserWindows: [] as unknown[],
  clipboard: { writeImage: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  // isEmpty() is what distinguishes a decoded image from the empty one
  // createFromBuffer hands back for undecodable input.
  nativeImage: {
    createFromBuffer: vi.fn(() => ({ isEmpty: (): boolean => false }))
  }
}))
vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: { getAllWindows: () => electron.browserWindows },
  clipboard: electron.clipboard,
  dialog: electron.dialog,
  nativeImage: electron.nativeImage,
  protocol: { handle: vi.fn(), unhandle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  screen: {
    getAllDisplays: () => electron.displays,
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => electron.cursorDisplay ?? electron.displays[0],
    getPrimaryDisplay: () => electron.primaryDisplay ?? electron.displays[0]
  }
}))

/** A stand-in for an encoded PNG; only its identity matters to these assertions. */
const PNG_BYTES = new Uint8Array([137, 80, 78, 71])

const { writeFileSyncMock } = vi.hoisted(() => ({ writeFileSyncMock: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return { ...actual, default: actual, writeFileSync: writeFileSyncMock }
})

// ─── Lifecycle base ───────────────────────────────────────────────────────────

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected registerDisposable<T>(disposable: T): T {
      return disposable
    }
  }
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' }
  }
})

// ─── Service container ────────────────────────────────────────────────────────

type FakeWindow = ReturnType<typeof createFakeWindow>

function createFakeWindow() {
  return {
    setOpacity: vi.fn(),
    setBounds: vi.fn(),
    setWindowButtonVisibility: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    show: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    webContents: new EventEmitter()
  }
}

const container = vi.hoisted(() => {
  const preferences = new Map<string, unknown>()
  const mediaEntries = new Map<string, Buffer>()
  const windows = new Map<string, unknown>()
  const createdListeners: Array<(managed: unknown) => void> = []
  let mediaSeq = 0

  const preferenceService = {
    get: (key: string) => preferences.get(key),
    subscribeChange: vi.fn<(key: string, callback: (value: boolean) => void) => () => void>(() => vi.fn())
  }

  const mediaProtocolService = {
    store: vi.fn((_kind: string, data: Buffer) => {
      const id = `media-${++mediaSeq}`
      mediaEntries.set(id, data)
      return id
    }),
    remove: vi.fn((_kind: string, id: string) => mediaEntries.delete(id)),
    has: vi.fn((_kind: string, id: string) => mediaEntries.has(id)),
    getUrl: vi.fn((kind: string, id: string) => `cherry-media://${kind}/${id}`)
  }

  const openCalls: Array<{ id: string; args: any }> = []
  const windowManager = {
    // Keyed on the display origin, so the same display hands back the same window
    // on a later session — the pooled-recycle behaviour this service must survive.
    open: vi.fn((type: string, args: any) => {
      const id = `overlay-${args.options.x}-${args.options.y}`
      let window = windows.get(id)
      if (!window) {
        window = createFakeWindow()
        windows.set(id, window)
        for (const listener of createdListeners) listener({ id, window, type })
      }
      openCalls.push({ id, args })
      return id
    }),
    getWindow: vi.fn((id: string) => windows.get(id)),
    close: vi.fn(() => true),
    setInitData: vi.fn(),
    suspendPool: vi.fn(() => 0),
    resumePool: vi.fn(),
    onWindowCreatedByType: vi.fn((_type: string, listener: (managed: unknown) => void) => {
      createdListeners.push(listener)
      return { dispose: vi.fn() }
    })
  }

  const ipcApiService = { send: vi.fn(), broadcast: vi.fn(), broadcastToType: vi.fn() }

  const ocrInferenceService = {
    recognize:
      vi.fn<(paths: unknown, source: { imageBytes: Uint8Array }) => Promise<{ text: string; lines: unknown[] }>>()
  }

  return {
    preferences,
    mediaEntries,
    windows,
    createdListeners,
    openCalls,
    overrides: {
      PreferenceService: preferenceService,
      MediaProtocolService: mediaProtocolService,
      WindowManager: windowManager,
      IpcApiService: ipcApiService,
      OcrInferenceService: ocrInferenceService
    },
    preferenceService,
    mediaProtocolService,
    windowManager,
    ipcApiService,
    ocrInferenceService,
    reset() {
      preferences.clear()
      mediaEntries.clear()
      windows.clear()
      createdListeners.length = 0
      openCalls.length = 0
      mediaSeq = 0
    }
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory(container.overrides)
})

const { mockMainLoggerService } = await import('@test-mocks/MainLoggerService')
const { ScreenshotOverlayService } = await import('../ScreenshotOverlayService')
const { ScreenCapturePermissionError } = await import('../types')

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeDisplay = (id: number, x: number, y: number, width = 1920, height = 1080, scaleFactor = 1) =>
  ({ id, bounds: { x, y, width, height }, scaleFactor }) as unknown as Display

const makeCapture = (width = 1920, height = 1080): CaptureResult => ({
  buffer: Buffer.from([1, 2, 3]),
  width,
  height
})

const makeWindowInfo = (over: Partial<RawWindowInfo> = {}): RawWindowInfo => ({
  pid: 4242,
  title: 'Notes',
  appName: 'Notes',
  x: 10,
  y: 20,
  width: 400,
  height: 300,
  isMinimized: false,
  ...over
})

let service: InstanceType<typeof ScreenshotOverlayService>

/** Reach a private map for the leak / residue guards; there is no public reader. */
const privateMap = (name: string) => Reflect.get(service, name) as Map<unknown, unknown>

const fakeWindow = (id: string) => container.windows.get(id) as FakeWindow

const initDataOf = (id: string) => {
  const call = [...container.openCalls].reverse().find((c) => c.id === id)
  return call?.args.initData
}

const startService = () => {
  service = new ScreenshotOverlayService()
  ;(service as unknown as { onInit(): void }).onInit()
}

/** An OCR request rect, tagged by `x` so the fake recognizer can name it. */
const ocrRegion = (tag: number) => ({ x: tag, y: 0, width: 100, height: 100 })

/** How long the fake recognizer occupies the inference service, in fake-timer ms. */
const FAKE_RECOGNITION_MS = 10

/**
 * Replaces the inference service with one that takes measurable time, recording which
 * regions actually reached it. Timer-driven rather than manually released, so a broken
 * implementation fails an assertion instead of hanging on a gate nobody opens.
 */
function gateInferenceService() {
  const reached: number[] = []
  let announceStart: (() => void) | null = null

  container.ocrInferenceService.recognize.mockImplementation(
    async (_paths: unknown, source: { imageBytes: Uint8Array }) => {
      reached.push(source.imageBytes[0])
      announceStart?.()
      announceStart = null
      await new Promise<void>((resolve) => setTimeout(resolve, FAKE_RECOGNITION_MS))
      return { text: '', lines: [] }
    }
  )

  return {
    reached,
    /** Arm before issuing a request, await after, to know the worker really started. */
    nextStart: () => new Promise<void>((resolve) => (announceStart = resolve))
  }
}

/** Single 1920×1080 display at the origin, authorized, feature on. */
const singleDisplaySetup = () => {
  electron.displays = [makeDisplay(1, 0, 0)]
  electron.cursorDisplay = electron.displays[0]
  capture.captureAllMonitors.mockReturnValue(new Map([[1, makeCapture()]]))
  capture.listMonitors.mockReturnValue([
    { id: 1, name: 'M1', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true }
  ])
}

describe('ScreenshotOverlayService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    container.reset()
    platform.isMac = true
    platform.isWin = false
    platform.isDev = false
    electron.displays = []
    electron.cursorDisplay = undefined
    electron.primaryDisplay = undefined
    electron.browserWindows = []
    container.preferences.set('feature.screenshot.enabled', true)
    container.preferences.set('feature.screenshot.auto_ocr', true)
    capture.getScreenCapturePermissionStatus.mockReturnValue('authorized')
    capture.listWindows.mockReturnValue([])
    capture.listMonitors.mockReturnValue([])
    capture.captureAllMonitors.mockReturnValue(new Map())
    localModel.isLocalModelReady.mockReturnValue(true)
    container.ocrInferenceService.recognize.mockResolvedValue({ text: '', lines: [] })
    startService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('session lifecycle', () => {
    it('opens exactly one overlay per display, at that display floored bounds', async () => {
      // Electron reports fractional bounds under DPI scaling; the leftover fraction
      // shows up as a 1px uncovered strip at the display edge.
      electron.displays = [makeDisplay(1, 0, 0, 1919.9999, 1080.4), makeDisplay(2, 1920, 0)]
      electron.cursorDisplay = electron.displays[0]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )

      await service.startCapture()

      expect(container.openCalls).toHaveLength(2)
      expect(container.openCalls[0].args.options).toEqual({ x: 0, y: 0, width: 1919, height: 1080 })
      expect(container.openCalls[1].args.options).toEqual({ x: 1920, y: 0, width: 1920, height: 1080 })
    })

    it('is re-entrant safe: a second startCapture while overlays are open is a no-op', async () => {
      singleDisplaySetup()

      await service.startCapture()
      await service.startCapture()

      expect(container.openCalls).toHaveLength(1)
      expect(capture.captureAllMonitors).toHaveBeenCalledTimes(1)
    })

    it('starts one session only when a second hotkey press lands while the capture is in flight', async () => {
      singleDisplaySetup()
      capture.captureAllMonitors.mockReturnValue(Promise.resolve(new Map([[1, makeCapture()]])))

      const first = service.startCapture()
      const second = service.startCapture()
      await Promise.all([first, second])

      // Nothing is recorded until the capture resolves, so an overlay-list guard alone
      // lets the second press through: two captures, two media entries, two overlay sets
      // over one screen, and a session generation neither of them owns.
      expect(capture.captureAllMonitors).toHaveBeenCalledTimes(1)
      expect(container.openCalls).toHaveLength(1)
      expect(container.mediaEntries.size).toBe(1)
    })

    it('does not capture at all when the feature preference is off', async () => {
      singleDisplaySetup()
      container.preferences.set('feature.screenshot.enabled', false)

      await service.startCapture()

      expect(capture.captureAllMonitors).not.toHaveBeenCalled()
      expect(container.openCalls).toHaveLength(0)
    })

    it('releases every stored media entry AND session capture on dismiss', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      await service.startCapture()
      const storedIds = container.mediaProtocolService.store.mock.results.map((r) => r.value as string)
      expect(storedIds).toHaveLength(2)

      service.dismiss()

      // Media entries are never reclaimed automatically, so a missed remove() is a
      // permanent multi-MB leak that nothing else would surface.
      for (const id of storedIds) expect(container.mediaProtocolService.has('image', id)).toBe(false)
      expect(privateMap('sessionCaptures').size).toBe(0)
      expect(privateMap('overlayMediaIds').size).toBe(0)
    })

    it('closes the overlays it already opened when a later display throws', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      container.mediaProtocolService.store
        .mockImplementationOnce(() => 'media-1')
        .mockImplementationOnce(() => {
          throw new Error('out of memory')
        })

      await service.startCapture()

      // Freeing the bookkeeping alone would strand a full-screen, always-on-top
      // window that nothing owns any more.
      expect(container.windowManager.close).toHaveBeenCalledWith('overlay-0-0')
      expect(service.isSessionOverlay('overlay-0-0')).toBe(false)
    })

    it('closes a window open() handed out but WindowManager can no longer resolve', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      container.windowManager.getWindow.mockImplementationOnce(() => undefined)

      await service.startCapture()

      // It never enters the session bookkeeping, so dismiss() would never close it and
      // the pooled window would hold one of the four recycle slots forever.
      expect(container.windowManager.close).toHaveBeenCalledWith('overlay-0-0')
      expect(service.isSessionOverlay('overlay-1920-0')).toBe(true)
    })

    it('treats a session in which no overlay could be opened as a failed capture', async () => {
      singleDisplaySetup()
      container.windowManager.getWindow.mockImplementationOnce(() => undefined)

      await service.startCapture()

      // Returning quietly leaves the user staring at an unchanged screen believing the
      // shortcut is broken, and pins the full-screen PNG in the media protocol forever.
      expect(mockMainLoggerService.error).toHaveBeenCalled()
      expect(container.mediaEntries.size).toBe(0)
    })
  })

  describe('overlay authorization', () => {
    it('isSessionOverlay accepts only the ids of the live session overlays', async () => {
      singleDisplaySetup()
      await service.startCapture()

      expect(service.isSessionOverlay('overlay-0-0')).toBe(true)
      expect(service.isSessionOverlay('some-other-window')).toBe(false)
    })

    it('isSessionOverlay rejects every id once the session is dismissed', async () => {
      singleDisplaySetup()
      await service.startCapture()
      service.dismiss()

      expect(service.isSessionOverlay('overlay-0-0')).toBe(false)
    })

    it('isActiveOverlay rejects a session overlay that is no longer the active one', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      await service.startCapture()

      service.markOverlayActive('overlay-0-0')
      service.markOverlayActive('overlay-1920-0')

      // The stale overlay is still part of the session, so session scope alone would
      // let its delayed commit copy a selection the user has already abandoned.
      expect(service.isSessionOverlay('overlay-0-0')).toBe(true)
      expect(service.isActiveOverlay('overlay-0-0')).toBe(false)
      expect(service.isActiveOverlay('overlay-1920-0')).toBe(true)
    })

    it('stops treating an overlay as active once the session is dismissed', async () => {
      singleDisplaySetup()
      await service.startCapture()
      service.markOverlayActive('overlay-0-0')

      service.dismiss()

      // isActiveOverlay is the whole gate on commit and save; leaving the id set lets a
      // request that lost the race write a result for a session that no longer exists.
      expect(service.isActiveOverlay('overlay-0-0')).toBe(false)
    })

    it('resets the previously active overlay when a different one takes over', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      await service.startCapture()

      service.markOverlayActive('overlay-0-0')
      service.markOverlayActive('overlay-1920-0')

      expect(container.ipcApiService.send).toHaveBeenCalledTimes(1)
      expect(container.ipcApiService.send).toHaveBeenCalledWith('overlay-0-0', 'screenshot.reset_overlay', undefined)
    })

    it('does not reset the active overlay when the same one re-reports activity', async () => {
      singleDisplaySetup()
      await service.startCapture()

      service.markOverlayActive('overlay-0-0')
      service.markOverlayActive('overlay-0-0')

      expect(container.ipcApiService.send).not.toHaveBeenCalled()
    })
  })

  describe('display matching', () => {
    it('falls back to coordinate matching when display ids do not line up with monitor ids', async () => {
      electron.displays = [makeDisplay(100, 0, 0)]
      electron.cursorDisplay = electron.displays[0]
      capture.captureAllMonitors.mockReturnValue(new Map([[1, makeCapture()]]))
      capture.listMonitors.mockReturnValue([
        { id: 1, name: 'M1', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true }
      ])

      await service.startCapture()

      expect(container.openCalls).toHaveLength(1)
    })

    it('normalizes native origins by the primary scale factor on Windows HiDPI', async () => {
      // Electron reports DIP while the native backend reports physical pixels in the
      // PRIMARY display's grid, so a secondary monitor never matches without tier 3.
      platform.isMac = false
      platform.isWin = true
      electron.displays = [makeDisplay(100, 0, 0, 1920, 1080, 1.5), makeDisplay(101, 1920, 0, 1920, 1080, 1)]
      electron.cursorDisplay = electron.displays[0]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [10, makeCapture(2880, 1620)],
          [11, makeCapture()]
        ])
      )
      capture.listMonitors.mockReturnValue([
        { id: 10, name: 'M1', x: 0, y: 0, width: 2880, height: 1620, scaleFactor: 1.5, isPrimary: true },
        { id: 11, name: 'M2', x: 2880, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: false }
      ])

      await service.startCapture()

      expect(container.openCalls.map((c) => c.id)).toEqual(['overlay-0-0', 'overlay-1920-0'])
    })

    it('takes the reference scale factor from the primary display, not from a display at the origin', async () => {
      // Under DPI scaling Electron reports fractional bounds, so no display sits exactly
      // at (0,0); guessing then silently falls back to 1 and tier 3 stops matching.
      platform.isMac = false
      platform.isWin = true
      electron.displays = [makeDisplay(100, 0.4, 0, 1920, 1080, 1.5), makeDisplay(101, 1920, 0, 1920, 1080, 1)]
      electron.primaryDisplay = electron.displays[0]
      electron.cursorDisplay = electron.displays[0]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [10, makeCapture(2880, 1620)],
          [11, makeCapture()]
        ])
      )
      capture.listMonitors.mockReturnValue([
        { id: 10, name: 'M1', x: 0, y: 0, width: 2880, height: 1620, scaleFactor: 1.5, isPrimary: true },
        { id: 11, name: 'M2', x: 2880, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: false }
      ])

      await service.startCapture()

      expect(container.openCalls.map((c) => c.id)).toEqual(['overlay-0-0', 'overlay-1920-0'])
    })

    it('gives a display with no matching capture no overlay and no media entry', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(new Map([[1, makeCapture()]]))
      capture.listMonitors.mockReturnValue([
        { id: 1, name: 'M1', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true }
      ])

      await service.startCapture()

      expect(container.openCalls.map((c) => c.id)).toEqual(['overlay-0-0'])
      expect(container.mediaProtocolService.store).toHaveBeenCalledTimes(1)
    })
  })

  describe('hit-test list', () => {
    it('excludes our own windows and minimized windows from the hit-test list', async () => {
      singleDisplaySetup()
      capture.listWindows.mockReturnValue([
        makeWindowInfo({ title: 'Our own window', pid: process.pid }),
        makeWindowInfo({ title: 'Minimized', isMinimized: true }),
        makeWindowInfo({ title: 'Visible' })
      ])

      await service.startCapture()

      expect(initDataOf('overlay-0-0').windows.map((w: { title: string }) => w.title)).toEqual(['Visible'])
    })

    it('drops the macOS Dock overlay by title, never by its localized owner name', async () => {
      singleDisplaySetup()
      capture.listWindows.mockReturnValue([
        makeWindowInfo({ title: 'Dock', appName: '程序坞', x: 0, y: 0, width: 1920, height: 1080 }),
        makeWindowInfo({ title: 'Visible' })
      ])

      await service.startCapture()

      expect(initDataOf('overlay-0-0').windows.map((w: { title: string }) => w.title)).toEqual(['Visible'])
    })

    it('keeps a window titled Dock off macOS', async () => {
      // Negative control: a title-only filter missing its platform guard would pass
      // the previous test and silently drop a real window on Windows.
      platform.isMac = false
      platform.isWin = true
      singleDisplaySetup()
      capture.listWindows.mockReturnValue([makeWindowInfo({ title: 'Dock' })])

      await service.startCapture()

      expect(initDataOf('overlay-0-0').windows.map((w: { title: string }) => w.title)).toEqual(['Dock'])
    })

    it('clips windows to the display, drops non-overlapping ones and edge slivers', async () => {
      electron.displays = [makeDisplay(1, 100, 100, 800, 600)]
      electron.cursorDisplay = electron.displays[0]
      capture.captureAllMonitors.mockReturnValue(new Map([[1, makeCapture(800, 600)]]))
      capture.listWindows.mockReturnValue([
        makeWindowInfo({ title: 'Partial', x: 0, y: 150, width: 250, height: 100 }),
        makeWindowInfo({ title: 'Outside', x: 1000, y: 1000, width: 100, height: 100 }),
        makeWindowInfo({ title: 'EdgeLine', x: 100, y: 100, width: 1, height: 600 })
      ])

      await service.startCapture()

      expect(initDataOf('overlay-100-100').windows).toEqual([
        { title: 'Partial', appName: 'Notes', x: 0, y: 50, width: 150, height: 100 }
      ])
    })

    it('converts window rects with each display own scale factor on Windows', async () => {
      // Using the primary's factor for the secondary display is the classic
      // mixed-DPI bug: every highlight there comes back offset and mis-sized.
      platform.isMac = false
      platform.isWin = true
      electron.displays = [makeDisplay(1, 0, 0, 1920, 1080, 1.5), makeDisplay(2, 1920, 0, 1920, 1080, 1)]
      electron.cursorDisplay = electron.displays[0]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture(2880, 1620)],
          [2, makeCapture()]
        ])
      )
      capture.listWindows.mockReturnValue([
        makeWindowInfo({ title: 'OnPrimary', x: 300, y: 150, width: 600, height: 450 }),
        makeWindowInfo({ title: 'OnSecondary', x: 3000, y: 100, width: 400, height: 300 })
      ])

      await service.startCapture()

      expect(initDataOf('overlay-0-0').windows).toEqual([
        { title: 'OnPrimary', appName: 'Notes', x: 200, y: 100, width: 400, height: 300 }
      ])
      expect(initDataOf('overlay-1920-0').windows).toEqual([
        { title: 'OnSecondary', appName: 'Notes', x: 120, y: 100, width: 400, height: 300 }
      ])
    })
  })

  describe('overlay reveal', () => {
    it('passes initData through open() so a recycled window receives the new capture', async () => {
      singleDisplaySetup()

      await service.startCapture()
      const firstMediaId = initDataOf('overlay-0-0').mediaId
      service.dismiss()
      await service.startCapture()
      const secondMediaId = initDataOf('overlay-0-0').mediaId

      // setInitData only writes storage; it fires no reuse event, and a recycled
      // window's renderer never re-reads it — it would keep showing the old capture.
      expect(container.windowManager.setInitData).not.toHaveBeenCalled()
      expect(secondMediaId).not.toBe(firstMediaId)
      expect(initDataOf('overlay-0-0').imageUrl).toContain(secondMediaId)
    })

    it('re-applies the all-workspaces flag when a pooled overlay is reused on macOS', async () => {
      singleDisplaySetup()
      await service.startCapture()
      service.dismiss()
      const window = fakeWindow('overlay-0-0')
      window.setVisibleOnAllWorkspaces.mockClear()

      await service.startCapture()

      // The window behavior applies this only at creation and macOS drops the flag when a pooled
      // overlay is hidden, so from the second capture on it neither covers a fullscreen Space nor takes Esc.
      expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
    })

    it('shows every overlay window, not merely sets its opacity', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )

      await service.startCapture()

      // The window type declares showMode 'manual', so nothing else ever shows it and
      // setOpacity() on a hidden window is a no-op — the overlay would stay invisible.
      expect(fakeWindow('overlay-0-0').showInactive).toHaveBeenCalled()
      expect(fakeWindow('overlay-1920-0').showInactive).toHaveBeenCalled()
    })

    it('reveals an overlay on its renderer handshake and focuses only the cursor display', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      electron.cursorDisplay = electron.displays[1]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      await service.startCapture()

      service.markOverlayReady('overlay-0-0', initDataOf('overlay-0-0').mediaId)
      service.markOverlayReady('overlay-1920-0', initDataOf('overlay-1920-0').mediaId)

      expect(fakeWindow('overlay-0-0').setOpacity).toHaveBeenLastCalledWith(1)
      expect(fakeWindow('overlay-1920-0').setOpacity).toHaveBeenLastCalledWith(1)
      // Every overlay calling focus() makes the winner depend on event-loop order.
      expect(fakeWindow('overlay-0-0').focus).not.toHaveBeenCalled()
      expect(fakeWindow('overlay-1920-0').focus).toHaveBeenCalled()
    })

    it('ignores a ready report naming a previous session capture', async () => {
      singleDisplaySetup()
      await service.startCapture()
      const staleMediaId = initDataOf('overlay-0-0').mediaId
      service.dismiss()
      await service.startCapture()
      const window = fakeWindow('overlay-0-0')
      window.setOpacity.mockClear()

      service.markOverlayReady('overlay-0-0', staleMediaId)

      // A recycled overlay can report the old frame before it processes the new init
      // data; honouring that would uncover a window still showing the last capture.
      expect(window.setOpacity).not.toHaveBeenCalledWith(1)
    })

    it('still reveals the first session when startCapture is re-triggered before its timer fires', async () => {
      singleDisplaySetup()
      await service.startCapture()

      // Blocked by the re-entrance guard — and must not touch the generation on its
      // way out, or the live session's pending reveal becomes a no-op forever.
      await service.startCapture()
      vi.advanceTimersByTime(1000)

      expect(fakeWindow('overlay-0-0').setOpacity).toHaveBeenLastCalledWith(1)
    })

    it('leaves no pending reveal or fallback timer behind after dismiss', async () => {
      singleDisplaySetup()
      await service.startCapture()

      service.dismiss()

      expect(privateMap('pendingReveals').size).toBe(0)
      vi.advanceTimersByTime(5000)
      expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
    })

    it('aborts the session when an overlay renderer goes away, instead of revealing a dead window', async () => {
      singleDisplaySetup()
      await service.startCapture()
      const window = fakeWindow('overlay-0-0')
      window.setOpacity.mockClear()

      window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

      // setOpacity(1) cannot restore key handling: revealing it would leave a
      // full-screen, always-on-top window that swallows clicks and ignores Esc.
      expect(container.windowManager.close).toHaveBeenCalledWith('overlay-0-0')
      expect(service.isSessionOverlay('overlay-0-0')).toBe(false)
      expect(window.setOpacity).not.toHaveBeenCalledWith(1)
      vi.advanceTimersByTime(5000)
      expect(window.setOpacity).not.toHaveBeenCalledWith(1)
    })

    it('keeps the session alive through a benign load failure, and only aborts on a main-frame one', async () => {
      singleDisplaySetup()
      await service.startCapture()
      const window = fakeWindow('overlay-0-0')

      // A cancelled/superseded navigation and a subframe failure both leave a perfectly
      // usable overlay; tearing the session down there makes the shortcut look broken.
      window.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'about:blank', true)
      window.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///frame.html', false)
      expect(service.isSessionOverlay('overlay-0-0')).toBe(true)

      window.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///overlay.html', true)

      expect(service.isSessionOverlay('overlay-0-0')).toBe(false)
    })
  })

  describe('results', () => {
    it('copies the result to the clipboard and ends the session', async () => {
      singleDisplaySetup()
      await service.startCapture()

      service.commit({ pngBytes: PNG_BYTES })

      expect(electron.nativeImage.createFromBuffer).toHaveBeenCalledWith(Buffer.from(PNG_BYTES))
      expect(electron.clipboard.writeImage).toHaveBeenCalled()
      expect(service.isSessionOverlay('overlay-0-0')).toBe(false)
    })

    it('still dismisses the overlays when the clipboard write throws', async () => {
      singleDisplaySetup()
      await service.startCapture()
      electron.clipboard.writeImage.mockImplementationOnce(() => {
        throw new Error('clipboard busy')
      })

      service.commit({ pngBytes: PNG_BYTES })

      expect(service.isSessionOverlay('overlay-0-0')).toBe(false)
    })

    it('leaves the clipboard untouched when the result bytes cannot be decoded', async () => {
      singleDisplaySetup()
      await service.startCapture()
      electron.nativeImage.createFromBuffer.mockReturnValueOnce({ isEmpty: () => true })

      service.commit({ pngBytes: new Uint8Array([1, 2]) })

      // createFromBuffer returns an EMPTY image instead of throwing, so writing it
      // replaces the clipboard with nothing while the user is told it was copied.
      expect(electron.clipboard.writeImage).not.toHaveBeenCalled()
      expect(mockMainLoggerService.info).not.toHaveBeenCalledWith(expect.stringContaining('clipboard'))
      expect(mockMainLoggerService.error).toHaveBeenCalled()
    })

    it('writes no file when the result bytes cannot be decoded', async () => {
      singleDisplaySetup()
      await service.startCapture()
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/shot.png' })
      electron.nativeImage.createFromBuffer.mockReturnValueOnce({ isEmpty: () => true })

      await service.save({ pngBytes: new Uint8Array([1, 2]) })

      // Undecodable bytes written straight through would be a corrupt .png the log calls saved.
      expect(writeFileSyncMock).not.toHaveBeenCalled()
      expect(mockMainLoggerService.info).not.toHaveBeenCalledWith(expect.stringContaining('saved'))
      expect(mockMainLoggerService.error).toHaveBeenCalled()
    })

    it('writes no file when the session ends while the save dialog is open', async () => {
      singleDisplaySetup()
      await service.startCapture()
      electron.dialog.showSaveDialog.mockImplementationOnce(async () => {
        // screenshot.cancel is session-scoped, so Esc on any overlay lands here — the
        // modal's parent is hidden and pooled while the user still sees the panel.
        service.dismiss()
        return { canceled: false, filePath: '/tmp/shot.png' }
      })

      await service.save({ pngBytes: PNG_BYTES })

      expect(writeFileSyncMock).not.toHaveBeenCalled()
    })

    it('hides the overlays and opens a parentless save panel on macOS', async () => {
      singleDisplaySetup()
      await service.startCapture()
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/shot.png' })

      await service.save({ pngBytes: PNG_BYTES })

      // A parent window would render this as a sheet, and a sheet is invisible on a
      // transparent frameless overlay — the user would see a frozen screen instead.
      expect(electron.dialog.showSaveDialog).toHaveBeenCalledTimes(1)
      expect(electron.dialog.showSaveDialog.mock.calls[0]).toHaveLength(1)
      expect(fakeWindow('overlay-0-0').hide).toHaveBeenCalled()
      expect(electron.app.focus).toHaveBeenCalledWith({ steal: true })
      // The renderer's own PNG, not a round-trip through nativeImage's encoder.
      expect(writeFileSyncMock).toHaveBeenCalledWith('/tmp/shot.png', PNG_BYTES)
    })

    it('restores the overlays when the macOS save dialog is cancelled', async () => {
      singleDisplaySetup()
      await service.startCapture()
      service.markOverlayActive('overlay-0-0')
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

      await service.save({ pngBytes: PNG_BYTES })

      // Left hidden, the session would be stuck: nothing visible on screen, yet the
      // re-entrance guard still blocks every new capture.
      const window = fakeWindow('overlay-0-0')
      expect(window.show).toHaveBeenCalled()
      expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalled()
      expect(service.isSessionOverlay('overlay-0-0')).toBe(true)
    })

    it('parents the save dialog to the active overlay off macOS', async () => {
      platform.isMac = false
      platform.isWin = true
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      await service.startCapture()
      service.markOverlayActive('overlay-1920-0')
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

      await service.save({ pngBytes: PNG_BYTES })

      // Modal ownership is what puts the dialog on the display the user selected on;
      // a parentless dialog opens on the primary monitor instead.
      expect(electron.dialog.showSaveDialog.mock.calls[0][0]).toBe(fakeWindow('overlay-1920-0'))
      expect(fakeWindow('overlay-0-0').hide).not.toHaveBeenCalled()
    })
  })

  describe('permission', () => {
    it('does not stack a custom dialog on top of the OS prompt on a first ask in production', async () => {
      singleDisplaySetup()
      capture.getScreenCapturePermissionStatus.mockReturnValue('not-determined')
      capture.requestScreenCapturePermission.mockResolvedValue('authorized')

      await service.startCapture()
      await vi.runAllTimersAsync()

      expect(capture.requestScreenCapturePermission).toHaveBeenCalled()
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled()
      expect(capture.captureAllMonitors).not.toHaveBeenCalled()
    })

    it('shows the custom dialog on a first ask in development, where no OS prompt appears', async () => {
      platform.isDev = true
      singleDisplaySetup()
      capture.getScreenCapturePermissionStatus.mockReturnValue('not-determined')
      capture.requestScreenCapturePermission.mockResolvedValue('not-determined')
      electron.dialog.showMessageBox.mockResolvedValue({ response: 1 })

      await service.startCapture()
      await vi.runAllTimersAsync()

      expect(electron.dialog.showMessageBox).toHaveBeenCalled()
      // A dev run uses the generic Electron binary, so the System Settings entry the
      // user has to find is named after it, not after the product.
      expect(electron.app.getName).not.toHaveBeenCalled()
    })

    it('opens System Settings when the user picks that button after a denial', async () => {
      singleDisplaySetup()
      capture.getScreenCapturePermissionStatus.mockReturnValue('denied')
      electron.dialog.showMessageBox.mockResolvedValue({ response: 0 })

      await service.startCapture()
      await vi.runAllTimersAsync()

      expect(capture.requestScreenCapturePermission).not.toHaveBeenCalled()
      expect(capture.openScreenCaptureSettings).toHaveBeenCalled()
    })

    it('guides to permission rather than logging an error when the capture itself is denied', async () => {
      singleDisplaySetup()
      capture.captureAllMonitors.mockImplementation(() => {
        throw new ScreenCapturePermissionError()
      })
      electron.dialog.showMessageBox.mockResolvedValue({ response: 1 })

      await service.startCapture()
      await vi.runAllTimersAsync()

      expect(electron.dialog.showMessageBox).toHaveBeenCalled()
      expect(mockMainLoggerService.error).not.toHaveBeenCalled()
    })
  })

  describe('region OCR', () => {
    /** Two 1920×1080 displays side by side, each with its own capture. */
    const twoDisplaySetup = () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      electron.cursorDisplay = electron.displays[0]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      capture.listMonitors.mockReturnValue([
        { id: 1, name: 'M1', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true },
        { id: 2, name: 'M2', x: 1920, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: false }
      ])
    }

    it('rejects a media id belonging to another display of the same session', async () => {
      // Both overlays are session members, so session scope alone cannot stop display
      // A from asking for a recognition of display B's screen contents.
      twoDisplaySetup()
      await service.startCapture()
      const foreignMediaId = initDataOf('overlay-1920-0').mediaId

      const result = await service.recognizeText('overlay-0-0', foreignMediaId, ocrRegion(1))

      expect(result).toEqual({ status: 'rejected' })
      expect(container.ocrInferenceService.recognize).not.toHaveBeenCalled()
    })

    it('reports unavailable when the model is removed while the overlay is open', async () => {
      // initData said the model was ready; the user can delete it in settings minutes
      // later, and reporting "no text" there sends them looking for the wrong problem.
      singleDisplaySetup()
      await service.startCapture()
      localModel.isLocalModelReady.mockReturnValue(false)

      const result = await service.recognizeText('overlay-0-0', initDataOf('overlay-0-0').mediaId, ocrRegion(1))

      expect(result).toEqual({ status: 'unavailable' })
      expect(container.ocrInferenceService.recognize).not.toHaveBeenCalled()
    })

    it('trims a region whose extent overshoots the capture', async () => {
      const cropPng = vi.mocked((await import('@main/utils/image')).cropPng)
      singleDisplaySetup()
      await service.startCapture()
      const mediaId = initDataOf('overlay-0-0').mediaId

      // Rounding a scaled selection can put the rect a pixel past the edge.
      await service.recognizeText('overlay-0-0', mediaId, { x: 1900, y: 1070, width: 100, height: 100 })

      expect(cropPng.mock.calls[0][1]).toEqual({ x: 1900, y: 1070, width: 20, height: 10 })
    })

    it('rejects a region whose origin is outside the capture instead of cropping a sliver', async () => {
      singleDisplaySetup()
      await service.startCapture()

      const result = await service.recognizeText('overlay-0-0', initDataOf('overlay-0-0').mediaId, {
        x: 1920,
        y: 0,
        width: 100,
        height: 100
      })

      // Clamping the origin yields a 1px-wide slice that recognizes nothing, presenting
      // the caller's coordinate bug to the user as "there is no text here".
      expect(result).toEqual({ status: 'rejected' })
      expect(container.ocrInferenceService.recognize).not.toHaveBeenCalled()
    })

    // Serialization itself is OcrInferenceService's PQueue(concurrency: 1) and is covered
    // by its own tests; what this module owes is that a superseded request paints nothing.
    it('keeps only the newest of a burst, and never sends the superseded ones to the worker', async () => {
      singleDisplaySetup()
      await service.startCapture()
      const mediaId = initDataOf('overlay-0-0').mediaId
      const gate = gateInferenceService()

      // The first request must actually reach the worker before the rest are fired:
      // issued in one synchronous burst, even it would look superseded.
      const firstStarted = gate.nextStart()
      const first = service.recognizeText('overlay-0-0', mediaId, ocrRegion(1))
      await firstStarted

      const second = service.recognizeText('overlay-0-0', mediaId, ocrRegion(2))
      const third = service.recognizeText('overlay-0-0', mediaId, ocrRegion(3))
      const fourth = service.recognizeText('overlay-0-0', mediaId, ocrRegion(4))
      const fifth = service.recognizeText('overlay-0-0', mediaId, ocrRegion(5))

      await vi.advanceTimersByTimeAsync(1000)

      expect(await second).toEqual({ status: 'rejected' })
      expect(await third).toEqual({ status: 'rejected' })
      expect(await fourth).toEqual({ status: 'rejected' })
      expect(await fifth).toEqual({ status: 'ok', lines: [] })
      // The first is superseded by the time it returns, but it was already running —
      // it is the queued middle that is dropped without touching the worker.
      expect(await first).toEqual({ status: 'rejected' })
      expect(gate.reached).toEqual([1, 5])
    })

    it('answers the display the user switched to, not the one they left', async () => {
      twoDisplaySetup()
      await service.startCapture()
      const gate = gateInferenceService()

      const firstStarted = gate.nextStart()
      const onFirstDisplay = service.recognizeText('overlay-0-0', initDataOf('overlay-0-0').mediaId, ocrRegion(1))
      await firstStarted

      const onSecondDisplay = service.recognizeText(
        'overlay-1920-0',
        initDataOf('overlay-1920-0').mediaId,
        ocrRegion(2)
      )
      await vi.advanceTimersByTimeAsync(1000)

      // A per-window token would leave both live and let display A's late result paint
      // over the overlay the user actually moved to.
      expect(await onFirstDisplay).toEqual({ status: 'rejected' })
      expect(await onSecondDisplay).toEqual({ status: 'ok', lines: [] })
    })

    it('rejects a recognition that finishes after the pooled window entered a new session', async () => {
      singleDisplaySetup()
      await service.startCapture()
      const gate = gateInferenceService()

      const started = gate.nextStart()
      const pending = service.recognizeText('overlay-0-0', initDataOf('overlay-0-0').mediaId, ocrRegion(1))
      await started

      service.dismiss()
      await service.startCapture() // same pooled window id, new capture
      await vi.advanceTimersByTimeAsync(1000)

      // The overlay's React tree survives a pool recycle, so an `ok` here would paint
      // the previous capture's text onto the new one.
      expect(await pending).toEqual({ status: 'rejected' })
    })

    it('lets a new session recognize while the previous session request is still running', async () => {
      singleDisplaySetup()
      await service.startCapture()
      const gate = gateInferenceService()

      const started = gate.nextStart()
      const stale = service.recognizeText('overlay-0-0', initDataOf('overlay-0-0').mediaId, ocrRegion(1))
      await started

      service.dismiss()
      await service.startCapture()
      const fresh = service.recognizeText('overlay-0-0', initDataOf('overlay-0-0').mediaId, ocrRegion(2))
      await vi.advanceTimersByTimeAsync(1000)

      // The stale one must not resolve `ok`, or a pooled overlay would paint the
      // previous capture's text over the new one.
      expect(await stale).toEqual({ status: 'rejected' })
      expect(await fresh).toEqual({ status: 'ok', lines: [] })
    })
  })

  describe('keyboard focus', () => {
    it('focuses a hovered overlay without resetting the other display selection', async () => {
      electron.displays = [makeDisplay(1, 0, 0), makeDisplay(2, 1920, 0)]
      capture.captureAllMonitors.mockReturnValue(
        new Map([
          [1, makeCapture()],
          [2, makeCapture()]
        ])
      )
      await service.startCapture()
      service.markOverlayActive('overlay-0-0')

      service.focusOverlay('overlay-1920-0')

      // Hovering must only redirect the keyboard: routing it through
      // markOverlayActive would wipe the selection the user is still building.
      expect(fakeWindow('overlay-1920-0').focus).toHaveBeenCalled()
      expect(container.ipcApiService.send).not.toHaveBeenCalled()
      expect(service.isActiveOverlay('overlay-0-0')).toBe(true)
    })

    it('ignores a focus request from a window outside the session', async () => {
      singleDisplaySetup()
      await service.startCapture()

      service.focusOverlay('some-other-window')

      expect(fakeWindow('overlay-0-0').focus).not.toHaveBeenCalled()
    })
  })

  describe('pool', () => {
    it('releases the warm overlay windows when the feature is switched off', () => {
      const subscriber = container.preferenceService.subscribeChange.mock.calls.at(-1)?.[1]

      subscriber?.(false)

      expect(container.windowManager.suspendPool).toHaveBeenCalledWith(WindowType.Screenshot)
    })

    it('makes the pool usable again when the feature is switched back on', () => {
      // Positive control: an implementation that suspends unconditionally passes the
      // test above, and every later capture would then pay a cold window creation.
      const subscriber = container.preferenceService.subscribeChange.mock.calls.at(-1)?.[1]
      subscriber?.(false)
      container.windowManager.resumePool.mockClear()

      subscriber?.(true)

      expect(container.windowManager.resumePool).toHaveBeenCalledWith(WindowType.Screenshot)
      expect(container.windowManager.suspendPool).toHaveBeenCalledTimes(1)
    })
  })

  describe('permission warm-up', () => {
    const subscribeChange = () => container.preferenceService.subscribeChange.mock.calls.at(-1)?.[1]

    it('touches the capture backend when the feature is switched on, so macOS asks now', async () => {
      subscribeChange()?.(true)
      await vi.runAllTimersAsync()

      // macOS re-confirms consent periodically and raises the prompt on the next
      // ScreenCaptureKit call; unasked here, it lands mid-capture on a busy main process.
      expect(capture.listMonitors).toHaveBeenCalled()
    })

    it('leaves the native backend alone when the feature is switched off', async () => {
      subscribeChange()?.(false)
      await vi.runAllTimersAsync()

      expect(capture.listMonitors).not.toHaveBeenCalled()
    })

    it('leaves the native backend alone off macOS', async () => {
      // No consent to re-confirm there, and probing would load the native module the
      // feature deliberately defers until a capture actually happens.
      platform.isMac = false
      platform.isWin = true

      subscribeChange()?.(true)
      await vi.runAllTimersAsync()

      expect(capture.listMonitors).not.toHaveBeenCalled()
    })

    it('logs a warm-up failure instead of letting it escape or raise a dialog', async () => {
      capture.listMonitors.mockImplementation(() => {
        throw new Error('backend unavailable')
      })

      subscribeChange()?.(true)
      await vi.runAllTimersAsync()

      // A background convenience: an unhandled throw here would take down whatever
      // dispatched the preference change, and a dialog would ambush the settings page.
      expect(mockMainLoggerService.warn).toHaveBeenCalled()
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled()
    })
  })
})
