import { shell, webContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setOpenLinkExternal } from '../WebviewService'

type OpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' }

/**
 * Contract tests for the miniapp webview popup policy (S14):
 * the in-app (`allow`) branch must only let web origins open popups —
 * non-http(s) schemes have no legitimate target inside a webview popup.
 */

describe('setOpenLinkExternal', () => {
  let handler: OpenHandler

  beforeEach(() => {
    vi.clearAllMocks()
    const setWindowOpenHandler = vi.fn((cb: OpenHandler) => {
      handler = cb
    })
    vi.mocked(webContents.fromId).mockReturnValue({ setWindowOpenHandler } as never)
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
    vi.mocked(webContents.fromId).mockReturnValue(undefined as never)
    expect(() => setOpenLinkExternal(404, false)).not.toThrow()
  })
})
