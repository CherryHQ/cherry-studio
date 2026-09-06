import { describe, expect, it, vi } from 'vitest'

import { captureScreenshotViaCdp } from '../cdpScreenshot'

interface DebuggerStub {
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
  isAttached: ReturnType<typeof vi.fn>
  sendCommand: ReturnType<typeof vi.fn>
}

const makeWebContents = (debuggerOverrides: Partial<DebuggerStub> = {}, isDestroyed = false) => {
  // Mirror Electron's semantics: isAttached() reflects whether attach() succeeded,
  // so the finally-branch detach guard behaves as it does against a real session.
  let attached = false
  const dbg: DebuggerStub = {
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    isAttached: vi.fn(() => attached),
    sendCommand: vi.fn(async () => ({ data: 'QUJD' })),
    ...debuggerOverrides
  }
  const wc = {
    isDestroyed: vi.fn(() => isDestroyed),
    debugger: dbg
  }
  return { wc: wc as never as Electron.WebContents, dbg }
}

const CLIP = { x: 10, y: 20, width: 800, height: 600 }

describe('captureScreenshotViaCdp', () => {
  it('attaches, captures with the compositor recipe and detaches', async () => {
    const { wc, dbg } = makeWebContents()

    const dataUrl = await captureScreenshotViaCdp(wc, CLIP, 2)

    expect(dataUrl).toBe('data:image/png;base64,QUJD')
    expect(dbg.attach).toHaveBeenCalledWith('1.3')
    expect(dbg.detach).toHaveBeenCalledTimes(1)
    expect(dbg.sendCommand).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png',
      clip: { ...CLIP, scale: 2 },
      captureBeyondViewport: true,
      fromSurface: true
    })
  })

  it('reuses an already-attached session without detaching it', async () => {
    const { wc, dbg } = makeWebContents({ isAttached: vi.fn(() => true) })

    await captureScreenshotViaCdp(wc, CLIP, 1)

    expect(dbg.attach).not.toHaveBeenCalled()
    expect(dbg.detach).not.toHaveBeenCalled()
    expect(dbg.sendCommand).toHaveBeenCalledTimes(1)
  })

  it('throws without sending when attach fails (session owned by another client)', async () => {
    const { wc, dbg } = makeWebContents({
      attach: vi.fn(() => {
        throw new Error('Debugger is already attached to the target')
      })
    })

    await expect(captureScreenshotViaCdp(wc, CLIP, 1)).rejects.toThrow('CDP attach failed')
    expect(dbg.sendCommand).not.toHaveBeenCalled()
    expect(dbg.detach).not.toHaveBeenCalled()
  })

  it('detaches even when the capture command fails', async () => {
    const { wc, dbg } = makeWebContents({
      sendCommand: vi.fn(async () => {
        throw new Error('surface error')
      })
    })

    await expect(captureScreenshotViaCdp(wc, CLIP, 1)).rejects.toThrow('surface error')
    expect(dbg.detach).toHaveBeenCalledTimes(1)
  })

  it('rejects when the response carries no image data', async () => {
    const { wc, dbg } = makeWebContents({ sendCommand: vi.fn(async () => ({})) })

    await expect(captureScreenshotViaCdp(wc, CLIP, 1)).rejects.toThrow('no image data')
    expect(dbg.detach).toHaveBeenCalledTimes(1)
  })

  it('refuses a destroyed webContents', async () => {
    const { wc, dbg } = makeWebContents({}, true)

    await expect(captureScreenshotViaCdp(wc, CLIP, 1)).rejects.toThrow('destroyed')
    expect(dbg.attach).not.toHaveBeenCalled()
  })
})
