import { describe, expect, it, vi } from 'vitest'

import type { RawWindowInfo } from '@main/services/screenshot/types'
import { listWindowsOffThread, readWindowInfo } from '@main/services/screenshot/windowEnumerator'

const workerConstructor = vi.hoisted(() => vi.fn())

/** Drives one worker's events from the test, in the order a real one would emit them. */
class FakeWorker {
  private handlers = new Map<string, (arg: unknown) => void>()
  public unref = vi.fn()
  public terminate = vi.fn()
  public on(event: string, handler: (arg: unknown) => void) {
    this.handlers.set(event, handler)
    return this
  }
  public emit(event: string, arg?: unknown) {
    this.handlers.get(event)?.(arg)
  }
}

/** Start an enumeration and hand back the worker it spawned. */
const spawn = () => {
  const worker = new FakeWorker()
  workerConstructor.mockImplementationOnce(function WorkerMock() {
    return worker
  })
  return { worker, windows: listWindowsOffThread() }
}

const reply = (windows: RawWindowInfo[]) => ({ ok: true, windows, startedAt: 0, loadMs: 0, enumMs: 0 })

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
  const enumerated: RawWindowInfo[] = [{ pid: 1, title: 'A', x: 0, y: 0, width: 100, height: 50, isMinimized: false }]

  it('reports the windows the worker enumerated', async () => {
    const { worker, windows } = spawn()

    worker.emit('message', reply(enumerated))

    await expect(windows).resolves.toEqual(enumerated)
  })

  it('degrades to no snap targets when the worker reports a failure', async () => {
    const { worker, windows } = spawn()

    worker.emit('message', { ok: false, message: 'the native backend could not be loaded' })

    await expect(windows).resolves.toEqual([])
  })

  it('degrades to no snap targets when the worker errors', async () => {
    const { worker, windows } = spawn()

    worker.emit('error', new Error('worker crashed'))

    await expect(windows).resolves.toEqual([])
  })

  it('degrades to no snap targets when the worker exits without reporting', async () => {
    // Nothing else would settle the promise, and the caller awaits it before pushing.
    const { worker, windows } = spawn()

    worker.emit('exit', 1)

    await expect(windows).resolves.toEqual([])
  })

  it('degrades to no snap targets when the worker cannot be spawned', async () => {
    // Hover-to-snap is optional — it falls back to snapping to the whole display.
    // A rejection here would escape the caller's fire-and-forget `void`.
    workerConstructor.mockImplementationOnce(function WorkerMock() {
      throw new Error('cannot spawn')
    })

    await expect(listWindowsOffThread()).resolves.toEqual([])
  })
})
