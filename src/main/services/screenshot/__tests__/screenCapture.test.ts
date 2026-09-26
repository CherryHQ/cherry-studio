import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ScreenCaptureError, ScreenCapturePermissionError } from '@main/services/screenshot/types'

const { monitorAll, getMediaAccessStatus } = vi.hoisted(() => ({
  monitorAll: vi.fn(),
  getMediaAccessStatus: vi.fn()
}))

// Mock the LOADER, not 'node-screenshots': the package is reached through require(), which vi.mock
// cannot intercept. Being reachable as a plain ESM import is the whole reason the loader is separate.
vi.mock('@main/services/screenshot/nativeCaptureBackend', () => ({
  loadNativeCaptureBackend: () => ({ Monitor: { all: () => monitorAll() } })
}))
vi.mock('electron', () => ({
  systemPreferences: { getMediaAccessStatus: () => getMediaAccessStatus() },
  shell: { openExternal: vi.fn() }
}))
vi.mock('@main/core/platform', () => ({ isMac: true }))

const { captureAllMonitors } = await import('@main/services/screenshot/screenCapture')

const toPng = vi.fn<(copyOutputData: boolean) => Promise<Buffer>>(async () => Buffer.from([1]))

const makeMonitor = (id: number) => ({
  id: () => id,
  name: () => `M${id}`,
  x: () => 0,
  y: () => 0,
  width: () => 1920,
  height: () => 1080,
  scaleFactor: () => 2,
  isPrimary: () => id === 1,
  captureImage: async () => ({ width: 3840, height: 2160, toPng })
})

describe('screenCapture', () => {
  beforeEach(() => {
    monitorAll.mockReset()
    getMediaAccessStatus.mockReset()
    toPng.mockClear()
  })

  it('reports an empty monitor list as missing permission when the OS says so', async () => {
    getMediaAccessStatus.mockReturnValue('denied')
    monitorAll.mockReturnValue([])
    await expect(captureAllMonitors()).rejects.toThrow(ScreenCapturePermissionError)
  })

  // Negative control for the above: without it a catch-all that always throws
  // ScreenCapturePermissionError passes, sending users to System Settings over an unrelated fault.
  it('does NOT blame permission when the list is empty but access is granted', async () => {
    getMediaAccessStatus.mockReturnValue('granted')
    monitorAll.mockReturnValue([])
    await expect(captureAllMonitors()).rejects.toThrow(ScreenCaptureError)
    await expect(captureAllMonitors()).rejects.not.toThrow(ScreenCapturePermissionError)
  })

  it('does NOT blame permission when one authorized display of several fails, and names it', async () => {
    getMediaAccessStatus.mockReturnValue('granted')
    const broken = {
      ...makeMonitor(2),
      captureImage: async () => {
        throw new Error('encoder exploded')
      }
    }
    monitorAll.mockReturnValue([makeMonitor(1), broken])

    // Running the displays concurrently must not blur which one failed, nor turn an
    // encoder fault into a trip to System Settings.
    await expect(captureAllMonitors()).rejects.toThrow(ScreenCaptureError)
    await expect(captureAllMonitors()).rejects.toThrow('display 2')
    await expect(captureAllMonitors()).rejects.not.toThrow(ScreenCapturePermissionError)
  })

  it('samples every display concurrently instead of one after another', async () => {
    getMediaAccessStatus.mockReturnValue('granted')
    let inFlight = 0
    let peakInFlight = 0
    const slowMonitor = (id: number) => ({
      ...makeMonitor(id),
      captureImage: async () => {
        inFlight++
        peakInFlight = Math.max(peakInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inFlight--
        return { width: 3840, height: 2160, toPng }
      }
    })
    monitorAll.mockReturnValue([slowMonitor(1), slowMonitor(2)])

    await captureAllMonitors()

    // A serial loop finishes display 1 — encode included — before display 2 is sampled,
    // so the "frozen instant" the overlay presents differs per display.
    expect(peakInFlight).toBe(2)
  })

  it('captures every monitor keyed by its own id', async () => {
    getMediaAccessStatus.mockReturnValue('granted')
    monitorAll.mockReturnValue([makeMonitor(1), makeMonitor(2)])
    const captures = await captureAllMonitors()
    expect([...captures.keys()]).toEqual([1, 2])
    expect(captures.get(1)).toMatchObject({ width: 3840, height: 2160 })
  })

  // The argument IS the contract, not a call detail: `copyOutputData: false` hands
  // back a view of Rust-owned memory and crashes Electron (napi-rs/napi-rs#1346).
  it('copies the encoded PNG out of the native buffer', async () => {
    getMediaAccessStatus.mockReturnValue('granted')
    monitorAll.mockReturnValue([makeMonitor(1)])
    await captureAllMonitors()
    expect(toPng).toHaveBeenCalledWith(true)
  })
})
