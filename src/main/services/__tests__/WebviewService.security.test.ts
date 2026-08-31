import { BaseService } from '@main/core/lifecycle'
import { app, session, shell, webContents } from 'electron'
import type * as FsModule from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setOpenLinkExternal, WebviewService } from '../WebviewService'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  // The preload is a build artifact, so the source-tree path does not exist under Vitest.
  return { ...actual, default: actual, existsSync: () => true }
})

type OpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' }

describe('setOpenLinkExternal', () => {
  let handler: OpenHandler
  const siteSession = {}

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(session, { fromPartition: vi.fn(() => siteSession) })
    const setWindowOpenHandler = vi.fn((callback: OpenHandler) => {
      handler = callback
    })
    vi.mocked(webContents.fromId).mockReturnValue({ setWindowOpenHandler, session: siteSession } as never)
  })

  it('leaves a webview outside the site partition alone', () => {
    const setWindowOpenHandler = vi.fn()
    vi.mocked(webContents.fromId).mockReturnValue({ setWindowOpenHandler, session: {} } as never)

    setOpenLinkExternal(1, true)
    setOpenLinkExternal(1, false)

    expect(setWindowOpenHandler).not.toHaveBeenCalled()
  })

  it('allows only web origins in in-app mode', () => {
    setOpenLinkExternal(1, false)

    expect(handler({ url: 'https://cherrystudio.com/page' })).toEqual({ action: 'allow' })
    expect(handler({ url: 'http://cherrystudio.com/page' })).toEqual({ action: 'allow' })
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'mailto:support@example.com' })).toEqual({ action: 'deny' })
  })

  it('routes safe external URLs to the system browser and denies the guest popup', () => {
    setOpenLinkExternal(1, true)

    expect(handler({ url: 'https://cherrystudio.com/page' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://cherrystudio.com/page')
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the webview id is unknown', () => {
    vi.mocked(webContents.fromId).mockReturnValue(undefined as never)
    expect(() => setOpenLinkExternal(404, false)).not.toThrow()
  })
})

describe('the site webview preload', () => {
  type WillAttach = (
    event: unknown,
    webPreferences: { preload?: string; sandbox?: boolean },
    params: { partition?: string }
  ) => void
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

    const created = (
      vi.mocked(app.on).mock.calls as unknown as Array<[string, (event: unknown, contents: unknown) => void]>
    ).find(([event]) => event === 'web-contents-created')
    const contents = { on: vi.fn(), once: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false }
    created![1]({}, contents)
    willAttach = contents.on.mock.calls.find(([event]) => event === 'will-attach-webview')![1] as WillAttach
  })

  it('claims and hardens the preload slot for a site webview', () => {
    const webPreferences: { preload?: string; sandbox?: boolean } = {}

    willAttach({}, webPreferences, { partition: 'persist:webview' })

    expect(webPreferences.preload).toBe('/mock/feature.webview.preload_file')
    expect(webPreferences.sandbox).toBe(true)
  })

  it('yields the preload slot to a local mini app capability bridge', () => {
    const webPreferences: { preload?: string; sandbox?: boolean } = {}

    willAttach({}, webPreferences, { partition: 'persist:miniapp:com.example.mygame' })

    expect(webPreferences).toEqual({})
  })

  it('does not inject into an unrelated webview partition', () => {
    const webPreferences: { preload?: string; sandbox?: boolean } = {}

    willAttach({}, webPreferences, { partition: 'html-artifact-preview' })

    expect(webPreferences).toEqual({})
  })
})
