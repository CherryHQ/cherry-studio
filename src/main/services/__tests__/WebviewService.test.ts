import type * as FsModule from 'fs'

import { app, session, shell, webContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

import { setOpenLinkExternal, WebviewService } from '../WebviewService'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  // The relay preload is a BUILD artefact and `__dirname` is the source tree under vitest,
  // so the real check fails and the installer returns before registering anything at all.
  return { ...actual, default: actual, existsSync: () => true }
})

type OpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' }

/**
 * Contract tests for the miniapp webview popup policy (S14):
 * the in-app (`allow`) branch must only let web origins open popups —
 * non-http(s) schemes have no legitimate target inside a webview popup.
 */

describe('setOpenLinkExternal', () => {
  let handler: OpenHandler

  const siteSession = {}
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(session, { fromPartition: vi.fn(() => siteSession) })
    const setWindowOpenHandler = vi.fn((cb: OpenHandler) => {
      handler = cb
    })
    vi.mocked(webContents.fromId).mockReturnValue({ setWindowOpenHandler, session: siteSession } as never)
  })

  it('leaves a webview outside the site partition alone', () => {
    // A mini app guest carries a deny-all popup policy, and `setWindowOpenHandler` replaces
    // it: the renderer asking for this on a guest would hand it `shell.openExternal`.
    const setWindowOpenHandler = vi.fn()
    vi.mocked(webContents.fromId).mockReturnValue({ setWindowOpenHandler, session: {} } as never)

    setOpenLinkExternal(1, true)
    setOpenLinkExternal(1, false)

    expect(setWindowOpenHandler).not.toHaveBeenCalled()
  })

  describe('in-app mode (isExternal=false)', () => {
    beforeEach(() => {
      setOpenLinkExternal(1, false)
    })

    it('allows http and https popups', () => {
      expect(handler({ url: 'https://cherrystudio.com/page' })).toEqual({ action: 'allow' })
      expect(handler({ url: 'http://cherrystudio.com/page' })).toEqual({ action: 'allow' })
    })

    it.each([
      ['file scheme', 'file:///etc/passwd'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['mailto scheme (in isSafeExternalUrl but not an in-app target)', 'mailto:support@example.com'],
      ['editor deep-link (in isSafeExternalUrl but not an in-app target)', 'vscode://file/src/index.ts'],
      ['custom scheme', 'cherry://whatever']
    ])('denies a non-web popup URL (%s)', (_label, url) => {
      expect(handler({ url })).toEqual({ action: 'deny' })
      expect(shell.openExternal).not.toHaveBeenCalled()
    })
  })

  describe('external mode (isExternal=true)', () => {
    beforeEach(() => {
      setOpenLinkExternal(1, true)
    })

    it('still routes safe web URLs to the system browser and denies everything else', () => {
      expect(handler({ url: 'https://cherrystudio.com/page' })).toEqual({ action: 'deny' })
      expect(shell.openExternal).toHaveBeenCalledWith('https://cherrystudio.com/page')

      expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
      expect(shell.openExternal).toHaveBeenCalledTimes(1)
    })

    it('keeps isSafeExternalUrl semantics for external routing (mailto allowed via shell)', () => {
      expect(handler({ url: 'mailto:support@example.com' })).toEqual({ action: 'deny' })
      expect(shell.openExternal).toHaveBeenCalledWith('mailto:support@example.com')
    })
  })

  it('is a no-op when the webview id is unknown', () => {
    vi.mocked(webContents.fromId).mockReturnValue(undefined)
    expect(() => setOpenLinkExternal(404, false)).not.toThrow()
  })
})

describe('the keyboard relay preload', () => {
  type WillAttach = (event: unknown, webPreferences: { preload?: string }, params: { partition?: string }) => void
  let willAttach: WillAttach

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    Object.assign(session, {
      fromPartition: vi.fn(() => ({
        getUserAgent: () => 'Mozilla/5.0 CherryStudio/1.0 Electron/30.0 Safari/537',
        setUserAgent: vi.fn(),
        webRequest: { onBeforeSendHeaders: vi.fn() }
      }))
    })
    await (new WebviewService() as unknown as { onInit: () => Promise<void> }).onInit()

    // `app.on` is overloaded per event name, so TS narrows the recorded calls to the first.
    const created = (
      vi.mocked(app.on).mock.calls as unknown as Array<[string, (event: unknown, contents: unknown) => void]>
    ).find(([event]) => event === 'web-contents-created')
    const contents = { on: vi.fn() }
    created![1]({}, contents)
    willAttach = contents.on.mock.calls.find(([event]) => event === 'will-attach-webview')![1] as WillAttach
  })

  it('claims the preload slot for a site webview', () => {
    // The positive control. Without it the case below also passes for a build that
    // registers nothing at all, which is exactly what a wrong preload path produces.
    const webPreferences: { preload?: string } = {}

    willAttach({}, webPreferences, { partition: 'persist:webview' })

    expect(webPreferences.preload).toMatch(/miniApp\.js$/)
  })

  it('yields the preload slot to a LOCAL mini app, leaving it without the relay', () => {
    // `webPreferences.preload` is ONE slot and `webviewHost` writes the capability bridge
    // into it. Dropping this filter does not merely add a relay: whichever module happened
    // to register second wins, and a guest that loses its bridge has no capabilities at all.
    // The relay's absence is the known gap this pins — see the comment at the filter.
    const webPreferences: { preload?: string } = {}

    willAttach({}, webPreferences, { partition: 'persist:miniapp:com.example.mygame' })

    expect(webPreferences.preload).toBeUndefined()
  })
})
