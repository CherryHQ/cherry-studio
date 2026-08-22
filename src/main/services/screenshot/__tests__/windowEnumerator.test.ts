import { listWindowsOffThread, readWindowInfo } from '@main/services/screenshot/windowEnumerator'
import { describe, expect, it, vi } from 'vitest'

const workerConstructor = vi.hoisted(() => vi.fn())

vi.mock('node:worker_threads', () => ({ Worker: workerConstructor }))
vi.mock('@main/services/screenshot/nativeCaptureBackend', () => ({
  nativeCaptureBackendPath: () => '/fake/node-screenshots'
}))

const makeWindow = (over: Partial<Record<string, unknown>> = {}) => ({
  pid: () => 1,
  title: () => 'A',
  x: () => 10,
  y: () => 20,
  width: () => 30,
  height: () => 40,
  isMinimized: () => false,
  ...over
})

describe('readWindowInfo', () => {
  it('skips a window that disappears between the enumeration and a property read', () => {
    // Menus and tooltips close constantly, so a throwing accessor must cost that one
    // window, not the whole hit-test list.
    const dying = makeWindow({
      title: () => {
        throw new Error('window closed')
      }
    })

    expect(readWindowInfo(dying)).toBeNull()
  })

  it('reads exactly the fields a snap target needs', () => {
    // Each accessor re-queries the whole OS window list, so an unused field is
    // ~30ms of native work per capture on a normal working set.
    expect(readWindowInfo(makeWindow())).toEqual({
      pid: 1,
      title: 'A',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      isMinimized: false
    })
  })
})

describe('listWindowsOffThread', () => {
  it('degrades to no snap targets when the worker cannot be spawned', async () => {
    // Hover-to-snap is optional — it falls back to snapping to the whole display.
    // A rejection here would escape the caller's fire-and-forget `void`.
    workerConstructor.mockImplementationOnce(() => {
      throw new Error('cannot spawn')
    })

    await expect(listWindowsOffThread()).resolves.toEqual([])
  })
})
