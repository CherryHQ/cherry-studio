import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import type { WatcherEvent } from '../watcher'

const mocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void

  const watchers: Array<{
    close: ReturnType<typeof vi.fn<(...args: any[]) => any>>
    emit: (event: string, ...args: unknown[]) => void
    handlers: Map<string, Handler>
    removeAllListeners: ReturnType<typeof vi.fn<(...args: any[]) => any>>
  }> = []

  const watch = vi.fn((_path: string, _options: { usePolling?: boolean }) => {
    void _path
    void _options
    const handlers = new Map<string, Handler>()
    const watcher = {
      close: vi.fn().mockResolvedValue(undefined),
      emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
      handlers,
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler)
        return watcher
      }),
      removeAllListeners: vi.fn(() => handlers.clear())
    }
    watchers.push(watcher)
    return watcher
  })

  return { watch, watchers }
})

vi.mock('chokidar', () => ({ watch: mocks.watch }))

vi.mock('../danglingCache', () => ({
  danglingCache: { onFsEvent: vi.fn() }
}))

const loadCreateDirectoryWatcher = async (isWin: boolean) => {
  vi.doMock('@main/core/platform', () => ({ isWin }))
  const { createDirectoryWatcher } = await import('../watcher')
  return createDirectoryWatcher
}

describe('DirectoryWatcher error recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.watchers.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to polling instead of reporting a fatal error after a native Windows EPERM', async () => {
    const createDirectoryWatcher = await loadCreateDirectoryWatcher(true)
    const watcher = createDirectoryWatcher('C:/Notes' as AbsoluteFilePath)
    const events: string[] = []
    watcher.onEvent((event) => events.push(event.kind))

    const error = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    mocks.watchers[0].emit('error', error)

    expect(mocks.watch).toHaveBeenCalledTimes(2)
    expect(mocks.watch.mock.calls[1][1]).toMatchObject({ usePolling: true })
    expect(events).not.toContain('error')

    await watcher.close()
  })

  it('falls back to polling instead of reporting a fatal error after a native Windows EBUSY', async () => {
    const createDirectoryWatcher = await loadCreateDirectoryWatcher(true)
    const watcher = createDirectoryWatcher('C:/Notes' as AbsoluteFilePath)
    const events: string[] = []
    watcher.onEvent((event) => events.push(event.kind))

    const error = Object.assign(new Error('EBUSY: resource busy or locked, watch'), { code: 'EBUSY' })
    mocks.watchers[0].emit('error', error)

    expect(mocks.watch).toHaveBeenCalledTimes(2)
    expect(mocks.watch.mock.calls[1][1]).toMatchObject({ usePolling: true })
    expect(events).not.toContain('error')

    await watcher.close()
  })

  it('reports EPERM as fatal on non-Windows platforms', async () => {
    const createDirectoryWatcher = await loadCreateDirectoryWatcher(false)
    const watcher = createDirectoryWatcher('/notes' as AbsoluteFilePath)
    const events: string[] = []
    watcher.onEvent((event) => events.push(event.kind))

    const error = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    mocks.watchers[0].emit('error', error)

    expect(mocks.watch).toHaveBeenCalledTimes(1)
    expect(events).toContain('error')

    await watcher.close()
  })

  it('reports a second EPERM as fatal after the Windows watcher has fallen back to polling', async () => {
    const createDirectoryWatcher = await loadCreateDirectoryWatcher(true)
    const watcher = createDirectoryWatcher('C:/Notes' as AbsoluteFilePath)
    const events: string[] = []
    watcher.onEvent((event) => events.push(event.kind))

    const error = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    mocks.watchers[0].emit('error', error)
    mocks.watchers[1].emit('error', error)

    expect(mocks.watch).toHaveBeenCalledTimes(2)
    expect(events).toContain('error')

    await watcher.close()
  })

  it('retains the original Error in fatal events', async () => {
    const createDirectoryWatcher = await loadCreateDirectoryWatcher(false)
    const watcher = createDirectoryWatcher('/notes' as AbsoluteFilePath)
    const events: WatcherEvent[] = []
    watcher.onEvent((event) => events.push(event))
    const error = new Error('watcher failed')

    mocks.watchers[0].emit('error', error)

    expect(events).toEqual([{ kind: 'error', error }])
    expect(events[0].kind === 'error' && events[0].error).toBe(error)
    await watcher.close()
  })

  it('normalizes non-Error failures for fatal events without discarding the cause', async () => {
    const createDirectoryWatcher = await loadCreateDirectoryWatcher(false)
    const watcher = createDirectoryWatcher('/notes' as AbsoluteFilePath)
    const errors: Error[] = []
    watcher.onEvent((event) => {
      if (event.kind === 'error') errors.push(event.error)
    })

    mocks.watchers[0].emit('error', 'watcher unavailable')
    mocks.watchers[0].emit('error', null)
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    mocks.watchers[0].emit('error', revoked.proxy)

    expect(errors).toHaveLength(3)
    expect(errors.every((error) => error instanceof Error)).toBe(true)
    expect(errors[0].message).toBe('watcher unavailable')
    expect(errors[0].cause).toBe('watcher unavailable')
    expect(errors[1].cause).toBeNull()
    expect(errors[2].cause).toBe(revoked.proxy)
    await watcher.close()
  })

  it.each([{ code: 'EMFILE' }, { message: 'EMFILE: too many open files' }])(
    'uses non-Error diagnostics %s to recover with polling before emitting a fatal event',
    async (error) => {
      const createDirectoryWatcher = await loadCreateDirectoryWatcher(false)
      const watcher = createDirectoryWatcher('/notes' as AbsoluteFilePath)
      const events: WatcherEvent[] = []
      watcher.onEvent((event) => events.push(event))

      mocks.watchers[0].emit('error', error)

      expect(events).toEqual([])
      mocks.watchers[1].emit('change', '/notes/file.md')
      expect(events).toEqual([{ kind: 'change', path: '/notes/file.md' }])
      await watcher.close()
    }
  )
})
