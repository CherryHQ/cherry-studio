import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { showStartupRecovery } from '@main/services/startupRecovery'

import { requireSingleInstance } from '../singleInstance'

vi.mock('electron', () => ({
  app: { requestSingleInstanceLock: vi.fn(), on: vi.fn(), once: vi.fn(), removeListener: vi.fn() }
}))
vi.mock('node:net', () => ({ createServer: vi.fn(), connect: vi.fn() }))
vi.mock('@main/services/startupRecovery', () => ({ showStartupRecovery: vi.fn() }))

let server: EventEmitter & { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
let client: EventEmitter & { destroy: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.useFakeTimers()
  server = Object.assign(new EventEmitter(), {
    listen: vi.fn(() => {
      void Promise.resolve().then(() => server.emit('listening'))
    }),
    close: vi.fn()
  })
  client = Object.assign(new EventEmitter(), { destroy: vi.fn() })
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.mocked(createServer).mockReturnValue(server as unknown as ReturnType<typeof createServer>)
  vi.mocked(application.getPath).mockReturnValue('C:\\test.sqlite')
  vi.mocked(app.requestSingleInstanceLock).mockReturnValue(false)
  vi.mocked(showStartupRecovery).mockResolvedValue('exit')
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('single-instance startup gate', () => {
  it('only permits the lock owner to proceed', async () => {
    vi.mocked(app.requestSingleInstanceLock).mockReturnValue(true)
    expect(await requireSingleInstance()).toBe(true)
    expect(showStartupRecovery).not.toHaveBeenCalled()
    expect(server.close).toHaveBeenCalled()
  })

  it('exits without recovery when the existing instance acknowledges the launch', async () => {
    vi.mocked(app.requestSingleInstanceLock).mockImplementation(() => {
      const accept = vi.mocked(createServer).mock.calls[0][0] as (socket: unknown) => void
      accept(client)
      client.emit('data', Buffer.from('re'))
      client.emit('data', Buffer.from('ady'))
      return false
    })
    expect(await requireSingleInstance()).toBe(false)
    expect(showStartupRecovery).not.toHaveBeenCalled()
    expect(application.forceExit).toHaveBeenCalledWith(0)
    expect(server.close).toHaveBeenCalled()
  })

  it('offers recovery after no response and never proceeds without the lock', async () => {
    vi.mocked(showStartupRecovery).mockResolvedValue('retry')
    const result = requireSingleInstance()
    await vi.advanceTimersByTimeAsync(4999)
    expect(showStartupRecovery).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe(false)
    expect(showStartupRecovery).toHaveBeenCalledWith({ code: 'SQLITE_BUSY' }, 'C:\\test.sqlite', true)
    expect(application.relaunch).toHaveBeenCalled()
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
  })
})
