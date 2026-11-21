import { existsSync } from 'fs'
import type * as FsModule from 'fs'
import { resolve } from 'node:path'

import { app, session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

import { WebviewService } from '../WebviewService'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  // The preload is a build artifact, so the source-tree path does not exist under Vitest.
  return { ...actual, default: actual, existsSync: vi.fn(() => true) }
})

describe('the site webview preload', () => {
  type WillAttach = (
    event: { preventDefault: () => void },
    webPreferences: Electron.WebPreferences,
    params: { partition?: string; src?: string }
  ) => void

  async function attachListener(): Promise<WillAttach> {
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
    return contents.on.mock.calls.find(([event]) => event === 'will-attach-webview')![1] as WillAttach
  }

  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('claims and hardens the preload slot for a site webview', async () => {
    const willAttach = await attachListener()
    const partition = 'persist:webview'
    const webPreferences: Electron.WebPreferences = { partition }
    const event = { preventDefault: vi.fn() }

    willAttach(event, webPreferences, { partition })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences.preload).toBe(resolve('/mock/feature.webview.preload_file'))
    expect(webPreferences.sandbox).toBe(true)
  })

  it.each(['persist:miniapp:com.example.mygame', 'html-artifact-preview'])(
    'leaves the preload slot for the owner of %s',
    async (partition) => {
      const willAttach = await attachListener()
      const event = { preventDefault: vi.fn() }
      const webPreferences = { partition }

      willAttach(event, webPreferences, { partition })

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(webPreferences).toEqual({ partition })
    }
  )

  it('rejects a guest whose merged preferences select a different partition', async () => {
    const willAttach = await attachListener()
    const event = { preventDefault: vi.fn() }
    const webPreferences = { partition: 'persist:webview-us:example' }

    willAttach(event, webPreferences, { partition: 'persist:webview', src: 'about:blank' })

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(webPreferences).toEqual({ partition: 'persist:webview-us:example' })
  })

  it('enforces regional preparation even when the site preload is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const willAttach = await attachListener()
    const event = { preventDefault: vi.fn() }
    const partition = 'persist:webview-us:example'

    willAttach(event, { partition }, { partition, src: 'about:blank' })

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})
