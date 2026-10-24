import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComputerUse, type ComputerUseClient, type PermissionStatus } from '@cherrystudio/computer-use'
import { BaseService } from '@main/core/lifecycle'
import {
  getScreenCapturePermissionStatus,
  openScreenCaptureSettings,
  requestScreenCapturePermission
} from '@main/utils/screenCapturePermission'

import { ComputerUseService } from '../ComputerUseService'

const environment = vi.hoisted(() => ({ isMac: true }))
vi.mock('@main/core/platform', () => ({
  get isMac() {
    return environment.isMac
  }
}))
vi.mock('@main/utils/screenCapturePermission', () => ({
  getScreenCapturePermissionStatus: vi.fn(),
  openScreenCaptureSettings: vi.fn(),
  requestScreenCapturePermission: vi.fn()
}))

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
    ...{ resolveApp: vi.fn(), resolveAppIdentity: vi.fn(), perform: vi.fn() },
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
  vi.mocked(getScreenCapturePermissionStatus).mockReset()
  vi.mocked(requestScreenCapturePermission).mockReset()
  vi.mocked(openScreenCaptureSettings).mockReset()
  Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
  environment.isMac = true
  vi.mocked(getScreenCapturePermissionStatus).mockReturnValue('authorized')
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

const helperPermissions: PermissionStatus = {
  permissions: [
    unknown.permissions[0],
    { id: 'screenRecording', label: 'SDK screen label', status: 'unknown', interaction: 'systemSettings' },
    { id: 'futurePermission', label: 'Future permission', status: 'denied', interaction: 'none' }
  ]
}

function packagedClient(status = helperPermissions) {
  Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
  const helper = client({
    getPermissionStatus: vi.fn().mockResolvedValue(status),
    requestPermissions: vi.fn().mockResolvedValue(status)
  })
  vi.mocked(ComputerUse.start).mockResolvedValue(helper)
  return helper
}

function projected(status: string, interaction: string) {
  return {
    permissions: [
      helperPermissions.permissions[0],
      { ...helperPermissions.permissions[1], status, interaction },
      helperPermissions.permissions[2]
    ]
  }
}

describe('ComputerUseService packaged macOS permission attribution', () => {
  it.each([
    ['authorized', 'granted', 'none'],
    ['denied', 'denied', 'systemSettings'],
    ['restricted', 'unavailable', 'none'],
    ['not-determined', 'notDetermined', 'systemPrompt']
  ] as const)('projects host %s without changing SDK rows or objects', async (host, status, interaction) => {
    const sdk: PermissionStatus = {
      permissions: helperPermissions.permissions.map((row) => ({ ...row }))
    }
    if (host === 'denied') sdk.permissions[1].status = 'granted'
    const original = structuredClone(sdk)
    packagedClient(sdk)
    vi.mocked(getScreenCapturePermissionStatus).mockReturnValue(host)
    const result = await new TestService().getPermissionStatus()
    expect(result).toEqual(projected(status, interaction))
    expect(result).not.toBe(sdk)
    expect(result.permissions).not.toBe(sdk.permissions)
    expect(sdk).toEqual(original)
    expect(result.permissions[0]).toBe(sdk.permissions[0])
    expect(result.permissions[2]).toBe(sdk.permissions[2])
  })

  it.each([{ permissions: [] }, { permissions: [unknown.permissions[0]] }])(
    'does not fabricate a missing screen row: %j',
    async ({ permissions }) => {
      packagedClient({ permissions })
      expect(await new TestService().getPermissionStatus()).toEqual({ permissions })
    }
  )

  it.each([true, false])('preserves unpackaged SDK status even when host is contrary: mac=%s', async (isMac) => {
    environment.isMac = isMac
    const sdk = projected('granted', 'none') as PermissionStatus
    vi.mocked(getScreenCapturePermissionStatus).mockReturnValue('denied')
    const helper = client({
      getPermissionStatus: vi.fn().mockResolvedValue(sdk),
      requestPermissions: vi.fn().mockResolvedValue(sdk)
    })
    vi.mocked(ComputerUse.start).mockResolvedValue(helper)
    const service = new TestService()
    expect(await service.getPermissionStatus()).toBe(sdk)
    expect(await service.requestPermissions(['screenRecording', 'accessibility'])).toBe(sdk)
    expect(helper.requestPermissions).toHaveBeenCalledWith(
      { ids: ['screenRecording', 'accessibility'] },
      { signal: expect.any(AbortSignal) }
    )
    expect(getScreenCapturePermissionStatus).not.toHaveBeenCalled()
  })

  it.each([{ permissions: [] }, helperPermissions])(
    'preserves packaged Linux lists, requests, and errors: %j',
    async (sdk) => {
      environment.isMac = false
      const helper = packagedClient(sdk)
      const service = new TestService()
      expect(await service.getPermissionStatus()).toBe(sdk)
      expect(await service.requestPermissions(['screenRecording'])).toBe(sdk)
      expect(helper.requestPermissions).toHaveBeenCalledWith(
        { ids: ['screenRecording'] },
        { signal: expect.any(AbortSignal) }
      )
      const failure = new Error('SDK unavailable')
      vi.mocked(helper.getPermissionStatus).mockRejectedValue(failure)
      await expect(service.getPermissionStatus()).rejects.toBe(failure)
      expect(helper.close).toHaveBeenCalledTimes(3)
      expect(getScreenCapturePermissionStatus).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['authorized', 'granted', 'none', 0],
    ['restricted', 'unavailable', 'none', 0],
    ['denied', 'denied', 'systemSettings', 1]
  ] as const)(
    'uses only a read-only helper session for a screen request when host is %s',
    async (host, status, interaction, settings) => {
      const helper = packagedClient()
      vi.mocked(getScreenCapturePermissionStatus).mockReturnValue(host)
      expect(await new TestService().requestPermissions(['screenRecording'])).toEqual(projected(status, interaction))
      expect(helper.getPermissionStatus).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
      expect(helper.requestPermissions).not.toHaveBeenCalled()
      expect(requestScreenCapturePermission).not.toHaveBeenCalled()
      expect(openScreenCaptureSettings).toHaveBeenCalledTimes(settings)
      expect(helper.close).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['authorized', 'granted', 'none', 0],
    ['denied', 'denied', 'systemSettings', 1],
    ['not-determined', 'notDetermined', 'systemPrompt', 0],
    ['restricted', 'unavailable', 'none', 0]
  ] as const)(
    'rereads the host after the prompt and returns %s without a second prompt',
    async (afterPrompt, status, interaction, settings) => {
      const helper = packagedClient()
      let host: ReturnType<typeof getScreenCapturePermissionStatus> = 'not-determined'
      vi.mocked(getScreenCapturePermissionStatus).mockImplementation(() => host)
      vi.mocked(requestScreenCapturePermission).mockImplementation(async () => {
        host = afterPrompt
        return 'not-determined'
      })
      expect(await new TestService().requestPermissions(['screenRecording'])).toEqual(projected(status, interaction))
      expect(helper.requestPermissions).not.toHaveBeenCalled()
      expect(requestScreenCapturePermission).toHaveBeenCalledOnce()
      expect(openScreenCaptureSettings).toHaveBeenCalledTimes(settings)
    }
  )

  it('rereads host status after opening settings', async () => {
    packagedClient()
    let host: ReturnType<typeof getScreenCapturePermissionStatus> = 'denied'
    vi.mocked(getScreenCapturePermissionStatus).mockImplementation(() => host)
    vi.mocked(openScreenCaptureSettings).mockImplementation(() => {
      host = 'authorized'
    })
    expect(await new TestService().requestPermissions(['screenRecording'])).toEqual(projected('granted', 'none'))
  })

  it('keeps AX onboarding in the helper and projects host screen status on return', async () => {
    const helper = packagedClient()
    vi.mocked(getScreenCapturePermissionStatus).mockReturnValue('denied')
    expect(await new TestService().requestPermissions(['accessibility'])).toEqual(projected('denied', 'systemSettings'))
    expect(helper.requestPermissions).toHaveBeenCalledWith(
      { ids: ['accessibility'] },
      { signal: expect.any(AbortSignal) }
    )
    expect(openScreenCaptureSettings).not.toHaveBeenCalled()
    expect(requestScreenCapturePermission).not.toHaveBeenCalled()
  })

  it('finishes AX onboarding before a single host screen action and keeps the helper alive', async () => {
    const helper = packagedClient()
    const entered = Promise.withResolvers<void>()
    const onboarding = Promise.withResolvers<PermissionStatus>()
    vi.mocked(helper.requestPermissions).mockImplementation(() => {
      entered.resolve()
      return onboarding.promise
    })
    vi.mocked(getScreenCapturePermissionStatus).mockReturnValue('denied')
    const service = new TestService()
    const pending = service.requestPermissions(['screenRecording', 'accessibility', 'screenRecording'])
    await entered.promise
    expect(openScreenCaptureSettings).not.toHaveBeenCalled()
    expect(helper.close).not.toHaveBeenCalled()
    onboarding.resolve(helperPermissions)
    expect(await pending).toEqual(projected('denied', 'systemSettings'))
    expect(helper.requestPermissions).toHaveBeenCalledWith(
      { ids: ['accessibility'] },
      { signal: expect.any(AbortSignal) }
    )
    expect(openScreenCaptureSettings).toHaveBeenCalledOnce()
    expect(helper.close).toHaveBeenCalledOnce()
  })

  it('does not start a host action when helper status fails, and releases the session', async () => {
    const helper = packagedClient()
    const failure = new Error('preflight failed')
    vi.mocked(helper.getPermissionStatus).mockRejectedValue(failure)
    await expect(new TestService().requestPermissions(['screenRecording'])).rejects.toBe(failure)
    expect(openScreenCaptureSettings).not.toHaveBeenCalled()
    expect(requestScreenCapturePermission).not.toHaveBeenCalled()
    expect(helper.close).toHaveBeenCalledOnce()
  })

  it('shutdown after AX onboarding prevents the following host interaction', async () => {
    const helper = packagedClient()
    const entered = Promise.withResolvers<void>()
    const onboarding = Promise.withResolvers<PermissionStatus>()
    vi.mocked(helper.requestPermissions).mockImplementation(() => {
      entered.resolve()
      return onboarding.promise
    })
    vi.mocked(getScreenCapturePermissionStatus).mockReturnValue('denied')
    const service = new TestService()
    const pending = service.requestPermissions(['accessibility', 'screenRecording']).catch((error: Error) => error.name)
    await entered.promise
    const stop = service.stop()
    onboarding.resolve(helperPermissions)
    expect(await pending).toBe('AbortError')
    await stop
    expect(openScreenCaptureSettings).not.toHaveBeenCalled()
    expect(helper.close).toHaveBeenCalledOnce()
  })
})

describe('ComputerUseService host permission shutdown', () => {
  it('closes a late-starting helper without querying or prompting after shutdown', async () => {
    const helper = packagedClient()
    const starting = Promise.withResolvers<ComputerUseClient>()
    vi.mocked(ComputerUse.start).mockReturnValue(starting.promise)
    const service = new TestService()
    const pending = service.requestPermissions(['screenRecording']).catch((error: Error) => error.name)
    await vi.waitFor(() => expect(ComputerUse.start).toHaveBeenCalledOnce())
    const stop = service.stop()
    starting.resolve(helper)
    expect(await pending).toBe('AbortError')
    await stop
    expect(helper.getPermissionStatus).not.toHaveBeenCalled()
    expect(helper.requestPermissions).not.toHaveBeenCalled()
    expect(requestScreenCapturePermission).not.toHaveBeenCalled()
    expect(helper.close).toHaveBeenCalledOnce()
  })

  it('keeps a host prompt session alive and drains it on shutdown without opening settings', async () => {
    const helper = packagedClient()
    const entered = Promise.withResolvers<void>()
    const prompt = Promise.withResolvers<ReturnType<typeof getScreenCapturePermissionStatus>>()
    vi.mocked(getScreenCapturePermissionStatus).mockReturnValue('not-determined')
    vi.mocked(requestScreenCapturePermission).mockImplementation(() => {
      entered.resolve()
      return prompt.promise
    })
    const service = new TestService()
    const pending = service.requestPermissions(['screenRecording']).catch((error: Error) => error.name)
    await entered.promise
    const queued = service.getPermissionStatus().catch((error: Error) => error.name)
    let stopped = false
    const stop = service.stop().then(() => {
      stopped = true
    })
    expect(helper.close).not.toHaveBeenCalled()
    expect(stopped).toBe(false)
    vi.mocked(getScreenCapturePermissionStatus).mockReturnValue('denied')
    prompt.resolve('denied')
    expect(await pending).toBe('AbortError')
    expect(await queued).toBe('AbortError')
    await stop
    expect(openScreenCaptureSettings).not.toHaveBeenCalled()
    expect(helper.close).toHaveBeenCalledOnce()
    expect(ComputerUse.start).toHaveBeenCalledOnce()
  })
})
