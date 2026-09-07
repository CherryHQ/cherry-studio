import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { screenshotHandlers } from '../screenshot'

const overlayService = {
  isSessionOverlay: vi.fn(),
  isActiveOverlay: vi.fn(),
  startCapture: vi.fn(),
  commit: vi.fn(),
  save: vi.fn(async () => {}),
  dismiss: vi.fn(),
  markOverlayActive: vi.fn(),
  focusOverlay: vi.fn(),
  markOverlayReady: vi.fn(),
  recognizeText: vi.fn(async () => ({ status: 'ok', lines: [] }))
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'ScreenshotOverlayService') return overlayService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = (senderId: string | null) => ({ senderId })
const captureResult = { pngBytes: new Uint8Array([137, 80, 78, 71]) }
const ocrInput = { mediaId: 'media-1', region: { x: 0, y: 0, width: 10, height: 10 } }

/** Every route that consults a predicate, with the input its schema declares. */
const guardedRoutes = {
  'screenshot.commit': () => screenshotHandlers['screenshot.commit'](captureResult, ctx('overlay-a')),
  'screenshot.save': () => screenshotHandlers['screenshot.save'](captureResult, ctx('overlay-a')),
  'screenshot.cancel': () => screenshotHandlers['screenshot.cancel'](undefined, ctx('overlay-a')),
  'screenshot.overlay_active': () => screenshotHandlers['screenshot.overlay_active'](undefined, ctx('overlay-a')),
  'screenshot.overlay_focus': () => screenshotHandlers['screenshot.overlay_focus'](undefined, ctx('overlay-a')),
  'screenshot.overlay_ready': () =>
    screenshotHandlers['screenshot.overlay_ready']({ mediaId: 'media-1' }, ctx('overlay-a')),
  'screenshot.recognize_text': () => screenshotHandlers['screenshot.recognize_text'](ocrInput, ctx('overlay-a'))
}

/** Everything the routes delegate to, so "nothing happened" is checkable in one go. */
const expectNoDelegation = () => {
  expect(overlayService.commit).not.toHaveBeenCalled()
  expect(overlayService.save).not.toHaveBeenCalled()
  expect(overlayService.dismiss).not.toHaveBeenCalled()
  expect(overlayService.markOverlayActive).not.toHaveBeenCalled()
  expect(overlayService.focusOverlay).not.toHaveBeenCalled()
  expect(overlayService.markOverlayReady).not.toHaveBeenCalled()
  expect(overlayService.recognizeText).not.toHaveBeenCalled()
}

describe('screenshotHandlers', () => {
  describe('active scope', () => {
    beforeEach(() => {
      // A session overlay the user has moved away from: the one state that separates the two tiers,
      // and the one where display A's delayed request would copy or save an abandoned selection.
      overlayService.isSessionOverlay.mockReturnValue(true)
      overlayService.isActiveOverlay.mockReturnValue(false)
    })

    it('commit refuses an overlay that is no longer the active one', async () => {
      await guardedRoutes['screenshot.commit']()
      expect(overlayService.commit).not.toHaveBeenCalled()
    })

    it('save refuses an overlay that is no longer the active one', async () => {
      await guardedRoutes['screenshot.save']()
      expect(overlayService.save).not.toHaveBeenCalled()
    })

    it('recognize_text refuses an overlay that is no longer the active one', async () => {
      const output = await guardedRoutes['screenshot.recognize_text']()

      expect(overlayService.recognizeText).not.toHaveBeenCalled()
      // The overlay branches on result.status; `undefined` would throw in the renderer
      // instead of leaving the OCR layer as it was.
      expect(output).toEqual({ status: 'rejected' })
    })
  })

  describe('session scope', () => {
    beforeEach(() => {
      // Esc, hover, and the first-frame handshake all legitimately arrive from an
      // overlay that is not the active one; active scope would silently drop them.
      overlayService.isSessionOverlay.mockReturnValue(true)
      overlayService.isActiveOverlay.mockReturnValue(false)
    })

    it('cancel ends the session from any overlay, not just the active one', async () => {
      await guardedRoutes['screenshot.cancel']()
      expect(overlayService.dismiss).toHaveBeenCalledOnce()
    })

    it('overlay_active promotes a non-active overlay — it is the call that changes which one is active', async () => {
      await guardedRoutes['screenshot.overlay_active']()
      expect(overlayService.markOverlayActive).toHaveBeenCalledWith('overlay-a')
    })

    it('overlay_focus redirects the keyboard from a merely hovered overlay', async () => {
      await guardedRoutes['screenshot.overlay_focus']()
      expect(overlayService.focusOverlay).toHaveBeenCalledWith('overlay-a')
    })

    it('overlay_ready reveals an overlay that never became the active one', async () => {
      await guardedRoutes['screenshot.overlay_ready']()
      expect(overlayService.markOverlayReady).toHaveBeenCalledWith('overlay-a', 'media-1')
    })
  })

  describe('the active overlay itself', () => {
    beforeEach(() => {
      overlayService.isSessionOverlay.mockReturnValue(true)
      overlayService.isActiveOverlay.mockReturnValue(true)
    })

    it('forwards commit and save', async () => {
      await guardedRoutes['screenshot.commit']()
      await guardedRoutes['screenshot.save']()

      expect(overlayService.commit).toHaveBeenCalledWith(captureResult)
      expect(overlayService.save).toHaveBeenCalledWith(captureResult)
    })

    it('forwards recognize_text with the caller own id and returns the service result', async () => {
      const output = await guardedRoutes['screenshot.recognize_text']()

      // The window id comes from the IPC context, never from the payload — a
      // renderer-supplied one would let an overlay read another display capture.
      expect(overlayService.recognizeText).toHaveBeenCalledWith('overlay-a', 'media-1', ocrInput.region)
      expect(output).toEqual({ status: 'ok', lines: [] })
    })
  })

  describe('a window outside the session', () => {
    beforeEach(() => {
      overlayService.isSessionOverlay.mockReturnValue(false)
      overlayService.isActiveOverlay.mockReturnValue(false)
    })

    it('gets nothing from any guarded route', async () => {
      for (const invoke of Object.values(guardedRoutes)) await invoke()

      expectNoDelegation()
    })

    it('can still start a capture — that entry point is only sender-scoped', async () => {
      // An in-app control is not an overlay and no session exists yet, so any session
      // predicate here would make the feature unreachable from inside the app.
      await screenshotHandlers['screenshot.capture'](undefined, ctx('main-window'))

      expect(overlayService.startCapture).toHaveBeenCalledOnce()
    })

    it('reports a failed capture to the caller instead of dropping it', async () => {
      overlayService.startCapture.mockRejectedValueOnce(new Error('capture backend is gone'))

      // startCapture is asynchronous: a handler that calls it without awaiting answers
      // "started" while the rejection becomes an unhandled promise nobody sees.
      await expect(screenshotHandlers['screenshot.capture'](undefined, ctx('main-window'))).rejects.toThrow(
        'capture backend is gone'
      )
    })
  })

  describe('a sender that is not a managed window', () => {
    beforeEach(() => {
      // Both predicates accept, so only the senderId check can refuse these.
      overlayService.isSessionOverlay.mockReturnValue(true)
      overlayService.isActiveOverlay.mockReturnValue(true)
    })

    it('gets nothing from any guarded route, and a rejected status from recognize_text', async () => {
      await screenshotHandlers['screenshot.commit'](captureResult, ctx(null))
      await screenshotHandlers['screenshot.save'](captureResult, ctx(null))
      await screenshotHandlers['screenshot.cancel'](undefined, ctx(null))
      await screenshotHandlers['screenshot.overlay_active'](undefined, ctx(null))
      await screenshotHandlers['screenshot.overlay_focus'](undefined, ctx(null))
      await screenshotHandlers['screenshot.overlay_ready']({ mediaId: 'media-1' }, ctx(null))
      const output = await screenshotHandlers['screenshot.recognize_text'](ocrInput, ctx(null))

      expectNoDelegation()
      expect(output).toEqual({ status: 'rejected' })
    })
  })
})
