import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void

  const watchers: Array<{
    close: ReturnType<typeof vi.fn>
    emit: (event: string, ...args: unknown[]) => void
    handlers: Map<string, Handler>
    removeAllListeners: ReturnType<typeof vi.fn>
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

const { createDirectoryWatcher } = await import('../watcher')

describe('DirectoryWatcher error recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.watchers.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to polling instead of reporting a fatal error after a native Windows EPERM', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const watcher = createDirectoryWatcher('C:/Notes' as FilePath)
    const events: string[] = []
    watcher.onEvent((event) => events.push(event.kind))

    const error = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    mocks.watchers[0].emit('error', error)

    expect(mocks.watch).toHaveBeenCalledTimes(2)
    expect(mocks.watch.mock.calls[1][1]).toMatchObject({ usePolling: true })
    expect(events).not.toContain('error')

    await watcher.close()
  })

  it('reports EPERM as fatal on non-Windows platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const watcher = createDirectoryWatcher('/notes' as FilePath)
    const events: string[] = []
    watcher.onEvent((event) => events.push(event.kind))

    const error = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    mocks.watchers[0].emit('error', error)

    expect(mocks.watch).toHaveBeenCalledTimes(1)
    expect(events).toContain('error')

    await watcher.close()
  })

  it('reports a second EPERM as fatal after the Windows watcher has fallen back to polling', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const watcher = createDirectoryWatcher('C:/Notes' as FilePath)
    const events: string[] = []
    watcher.onEvent((event) => events.push(event.kind))

    const error = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    mocks.watchers[0].emit('error', error)
    mocks.watchers[1].emit('error', error)

    expect(mocks.watch).toHaveBeenCalledTimes(2)
    expect(events).toContain('error')

    await watcher.close()
  })
})
