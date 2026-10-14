import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComputerUse, type ComputerUseClient, type PermissionStatus } from '@cherrystudio/computer-use'
import { BaseService } from '@main/core/lifecycle'

import { ComputerUseService } from '../ComputerUseService'

vi.mock('@cherrystudio/computer-use', () => ({ ComputerUse: { start: vi.fn() } }))

class TestService extends ComputerUseService {
  stop() {
    return this.onStop()
  }
}

const unknown: PermissionStatus = {
  permissions: [{ id: 'accessibility', label: 'Accessibility', status: 'unknown', interaction: 'systemSettings' }]
}

function client(overrides: Partial<ComputerUseClient> = {}): ComputerUseClient {
  return {
    getCapabilities: vi.fn(),
    listApps: vi.fn(),
    openAppSession: vi.fn(),
    listAppSessions: vi.fn(),
    stopAppSession: vi.fn(),
    getAppState: vi.fn(),
    act: vi.fn(),
    onClosed: vi.fn(),
    getPermissionStatus: vi.fn().mockResolvedValue(unknown),
    requestPermissions: vi.fn().mockResolvedValue(unknown),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

beforeEach(() => {
  BaseService.resetInstances()
  vi.clearAllMocks()
})

describe('ComputerUseService permission sessions', () => {
  it('queries with fresh sessions and never converts an OS request into a grant', async () => {
    const granted: PermissionStatus = {
      permissions: [{ ...unknown.permissions[0], status: 'granted', interaction: 'none' }]
    }
    const first = client()
    const request = client()
    const refreshed = client({ getPermissionStatus: vi.fn().mockResolvedValue(granted) })
    vi.mocked(ComputerUse.start)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce(refreshed)
    const service = new TestService()
    expect(ComputerUse.start).not.toHaveBeenCalled()
    expect(await service.getPermissionStatus()).toEqual(unknown)
    expect(first.requestPermissions).not.toHaveBeenCalled()
    expect(first.close).toHaveBeenCalledOnce()
    expect(await service.requestPermissions(['accessibility'])).toEqual(unknown)
    expect(request.requestPermissions).toHaveBeenCalledWith(
      { ids: ['accessibility'] },
      { signal: expect.any(AbortSignal) }
    )
    expect(request.close).toHaveBeenCalledOnce()
    expect(await service.getPermissionStatus()).toEqual(granted)
    expect(refreshed.close).toHaveBeenCalledOnce()
  })

  it('keeps the helper alive until onboarding finishes, then refreshes through a fresh session', async () => {
    const entered = Promise.withResolvers<void>()
    const dismissed = Promise.withResolvers<PermissionStatus>()
    const request = client({
      requestPermissions: () => {
        entered.resolve()
        return dismissed.promise
      }
    })
    const granted: PermissionStatus = {
      permissions: [{ ...unknown.permissions[0], status: 'granted', interaction: 'none' }]
    }
    const refreshed = client({ getPermissionStatus: vi.fn().mockResolvedValue(granted) })
    vi.mocked(ComputerUse.start).mockResolvedValueOnce(request).mockResolvedValueOnce(refreshed)
    const service = new TestService()
    const pending = service.requestPermissions(['accessibility'])
    await entered.promise
    const refresh = service.getPermissionStatus()
    expect(request.close).not.toHaveBeenCalled()
    expect(ComputerUse.start).toHaveBeenCalledOnce()
    dismissed.resolve(unknown)
    expect(await pending).toEqual(unknown)
    expect(await refresh).toEqual(granted)
    expect(request.close).toHaveBeenCalledOnce()
    expect(refreshed.close).toHaveBeenCalledOnce()
  })

  it('releases the helper on failure and allows a later status query to recover', async () => {
    const failed = client({ getPermissionStatus: vi.fn().mockRejectedValue(new Error('disconnected')) })
    vi.mocked(ComputerUse.start).mockResolvedValueOnce(failed).mockResolvedValueOnce(client())
    const service = new TestService()
    await expect(service.getPermissionStatus()).rejects.toThrow('disconnected')
    expect(failed.close).toHaveBeenCalledOnce()
    expect(await service.getPermissionStatus()).toEqual(unknown)
  })

  it('shutdown cancels active work, drains cleanup, and prevents queued prompts from starting', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const active = client({
      requestPermissions: (_, { signal } = {}) =>
        new Promise((_, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
          entered.resolve()
        }),
      close: vi.fn(() => release.promise)
    })
    vi.mocked(ComputerUse.start).mockResolvedValue(active)
    const service = new TestService()
    const running = service.requestPermissions(['accessibility']).catch((error: Error) => error.name)
    await entered.promise
    const queued = service.requestPermissions(['accessibility']).catch((error: Error) => error.name)
    let stopped = false
    const stop = service.stop().then(() => {
      stopped = true
    })
    await vi.waitFor(() => expect(active.close).toHaveBeenCalledOnce())
    expect(stopped).toBe(false)
    release.resolve()
    expect(await running).toBe('AbortError')
    expect(await queued).toBe('AbortError')
    await stop
    expect(ComputerUse.start).toHaveBeenCalledOnce()
    await expect(service.getPermissionStatus()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
