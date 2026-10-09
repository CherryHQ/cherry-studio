import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComputerUse, type ComputerUseClient, type ClosedEvent, type Snapshot } from '@cherrystudio/computer-use'
import type * as ComputerUseModule from '@cherrystudio/computer-use'
import { BaseService } from '@main/core/lifecycle'

import { ComputerUseService } from '../ComputerUseService'

vi.mock('@cherrystudio/computer-use', async (original) => ({
  ...(await original<typeof ComputerUseModule>()),
  ComputerUse: { start: vi.fn() }
}))

class TestService extends ComputerUseService {
  init() {
    this.onInit()
  }
  stop() {
    return this.onStop()
  }
}

function backend(overrides: Partial<ComputerUseClient> = {}) {
  const events: string[] = []
  let sequence = 0
  let closed: ((event: ClosedEvent) => void) | undefined
  const snapshot: Snapshot = {
    id: 'snapshot',
    appSessionId: 'app-1',
    app: { id: 'app', name: 'Editor' },
    window: { id: 'window', title: 'Document' },
    tree: { status: 'available', elements: [], truncated: [] },
    screenshot: { status: 'unavailable', reason: { code: 'CAPTURE_FAILED', message: 'No capture' } }
  }
  const client: ComputerUseClient = {
    getCapabilities: async () => ({ platform: 'darwin', capabilities: [] }),
    getPermissionStatus: async () => ({ permissions: [] }),
    requestPermissions: async () => ({ permissions: [] }),
    listApps: async () => [{ id: 'app', name: 'Editor' }],
    openAppSession: async ({ appId }) => {
      events.push(`open:${appId}`)
      return { id: `${appId}-${++sequence}`, app: { id: appId, name: appId }, status: 'active' }
    },
    listAppSessions: async () => [],
    stopAppSession: async ({ appSessionId }) => {
      events.push(`stop:${appSessionId}`)
      return { appSessionId, status: 'stopped', cleanup: 'complete' }
    },
    getAppState: async () => snapshot,
    act: async (input) => {
      events.push(`click:${input.appSessionId}`)
      return { status: 'completed', observation: { status: 'available', snapshot } }
    },
    onClosed: (listener) => {
      closed = listener
      return () => {
        closed = undefined
      }
    },
    close: async () => {
      events.push('close')
      closed?.({ cleanup: 'complete' })
    },
    ...overrides
  }
  return { client, events, disconnect: (event: ClosedEvent) => closed?.(event) }
}

beforeEach(() => {
  BaseService.resetInstances()
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', true)
})

describe('desktop control ownership and user stop', () => {
  it('restores permission queries after a service restart without reviving stopped tasks', async () => {
    const native = backend()
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new ComputerUseService()
    await service._doInit()
    const task = service.createTask('owner', 'Conversation')
    await service.openApp(task, 'app')
    await service._doStop()
    await service._doInit()
    try {
      await expect(service.getPermissionStatus()).resolves.toEqual({ permissions: [] })
      await expect(service.listApps(task)).rejects.toMatchObject({ code: 'TASK_CLOSED' })
      await expect(service.listApps(service.createTask('owner', 'Conversation'))).rejects.toMatchObject({
        code: 'USER_STOPPED'
      })
      service.allowControl('owner')
      await expect(service.listApps(service.createTask('owner', 'Conversation'))).resolves.toMatchObject({
        apps: [{ id: 'app', name: 'Editor' }]
      })
    } finally {
      await service._doStop()
      await service._doDestroy()
    }
  })

  it('delivers control state changes to existing and new subscribers after a service restart', async () => {
    const native = backend()
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new ComputerUseService()
    await service._doInit()
    await service.openApp(service.createTask('owner', 'Conversation'), 'app')
    let existingView = service.getControls()
    const existing = service.onControlsChanged(() => {
      existingView = service.getControls()
    })
    await service._doStop()
    await service._doInit()
    let newView = service.getControls()
    const added = service.onControlsChanged(() => {
      newView = service.getControls()
    })
    try {
      expect(existingView).toMatchObject([{ ownerId: 'owner', status: 'stopped' }])
      expect(newView).toMatchObject([{ ownerId: 'owner', status: 'stopped' }])
      service.allowControl('owner')
      expect(existingView).toEqual([])
      expect(newView).toEqual([])
    } finally {
      existing.dispose()
      added.dispose()
      await service._doStop()
      await service._doDestroy()
    }
  })

  it('keeps an application owned across observations and clicks, sharing one runtime per task', async () => {
    const native = backend()
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new TestService()
    const first = service.createTask('first', 'First conversation')
    const other = service.createTask('other', 'Other conversation')
    const app = await service.openApp(first, 'app')
    expect(await service.openApp(first, 'app')).toEqual(app)
    await service.getAppState(first, { appSessionId: app.id })
    await expect(service.openApp(other, 'app')).rejects.toMatchObject({ code: 'APP_BUSY' })
    await expect(
      service.act(other, { appSessionId: app.id, snapshotId: 'snapshot', elementId: 'button', type: 'click' })
    ).rejects.toMatchObject({ code: 'UNKNOWN_APP_SESSION' })
    await service.act(first, { appSessionId: app.id, snapshotId: 'snapshot', elementId: 'button', type: 'click' })
    expect(native.events).toEqual(['open:app', 'click:app-1'])
    expect(ComputerUse.start).toHaveBeenCalledTimes(1)
    await service.finishTask(first)
    await expect(
      service.act(first, { appSessionId: app.id, snapshotId: 'snapshot', elementId: 'button', type: 'click' })
    ).rejects.toMatchObject({ code: 'TASK_CLOSED' })
    expect(native.events.at(-1)).toBe('close')
    await expect(service.openApp(other, 'app')).resolves.toMatchObject({ status: 'active' })
    await service.stop()
  })

  it('blocks retries and replacement runtimes after single-app stop while leaving another app usable', async () => {
    const stopped = Promise.withResolvers<void>()
    const native = backend({
      stopAppSession: async ({ appSessionId }) => {
        await stopped.promise
        return { appSessionId, status: 'stopped', cleanup: 'complete' }
      }
    })
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new TestService()
    const task = service.createTask('owner', 'Conversation')
    const app = await service.openApp(task, 'app')
    const second = await service.openApp(task, 'second')
    const stopping = service.stopApp('owner', 'app')
    expect(service.getControls().find((row) => row.appId === 'app')?.status).toBe('stopping')
    service.allowControl('owner', 'app')
    await expect(service.openApp(task, 'app')).rejects.toMatchObject({ code: 'USER_STOPPED' })
    await expect(
      service.act(task, { appSessionId: app.id, snapshotId: 'snapshot', elementId: 'button', type: 'click' })
    ).rejects.toMatchObject({ code: 'USER_STOPPED' })
    await service.act(task, { appSessionId: second.id, snapshotId: 'snapshot', elementId: 'button', type: 'click' })
    stopped.resolve()
    await stopping
    expect(service.getControls().find((row) => row.appId === 'app')?.status).toBe('stopped')
    const retry = service.createTask('owner', 'Conversation')
    await expect(service.openApp(retry, 'app')).rejects.toMatchObject({ code: 'USER_STOPPED' })
    service.allowControl('owner', 'app')
    const reopened = await service.openApp(task, 'app')
    expect(reopened.id).not.toBe(app.id)
    await expect(service.getAppState(task, { appSessionId: app.id })).rejects.toMatchObject({
      code: 'UNKNOWN_APP_SESSION'
    })
    expect(native.events).toEqual(['open:app', 'open:second', 'click:second-2', 'open:app'])
    await service.stop()
  })

  it('stops an application whose native open has not completed yet', async () => {
    const entered = Promise.withResolvers<void>()
    const opened = Promise.withResolvers<void>()
    const native = backend({
      openAppSession: async ({ appId }) => {
        entered.resolve()
        await opened.promise
        return { id: 'late-session', app: { id: appId, name: 'Late app' }, status: 'active' }
      }
    })
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new TestService()
    const task = service.createTask('owner', 'Conversation')
    const opening = service.openApp(task, 'app').catch((error) => error.code)
    await entered.promise
    const stopping = service.stopApp('owner', 'app')
    opened.resolve()
    expect(await opening).toBe('USER_STOPPED')
    await stopping
    expect(native.events).toEqual(['stop:late-session'])
    expect(service.getControls()[0].status).toBe('stopped')
    await service.stop()
  })

  it('drains pending startup on stop-all and does not allow a new target through a replacement task', async () => {
    const starting = Promise.withResolvers<ComputerUseClient>()
    const native = backend()
    vi.mocked(ComputerUse.start).mockReturnValue(starting.promise)
    const service = new TestService()
    const task = service.createTask('owner', 'Conversation')
    const opening = service.openApp(task, 'app').catch((error) => error.code)
    const stopping = service.stopAll()
    expect(service.getControls().some((row) => row.status === 'stopping')).toBe(true)
    starting.resolve(native.client)
    await stopping
    await opening
    expect(native.events).toEqual(['close'])
    await expect(service.openApp(service.createTask('owner', 'Conversation'), 'different')).rejects.toMatchObject({
      code: 'USER_STOPPED'
    })
    service.allowControl('owner')
    await expect(service.openApp(service.createTask('owner', 'Conversation'), 'different')).resolves.toMatchObject({
      status: 'active'
    })
    await service.stop()
  })

  it('retains uncertain cleanup and its application reservation instead of claiming stopped', async () => {
    const native = backend({
      stopAppSession: async () => {
        throw new Error('Cleanup unconfirmed')
      },
      close: async () => {
        throw new Error('Cleanup unconfirmed')
      }
    })
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new TestService()
    await service.openApp(service.createTask('owner', 'Conversation'), 'app')
    await service.stopApp('owner', 'app')
    expect(service.getControls().filter((row) => row.appId === 'app')).toMatchObject([{ status: 'unconfirmed' }])
    service.allowControl('owner')
    await expect(service.openApp(service.createTask('owner', 'Conversation'), 'app')).rejects.toMatchObject({
      code: 'USER_STOPPED'
    })
    await expect(service.openApp(service.createTask('other', 'Other'), 'app')).rejects.toMatchObject({
      code: 'APP_BUSY'
    })
    await service.stop()
  })

  it('revokes current and queued work when the user disables desktop control', async () => {
    const native = backend()
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new TestService()
    service.init()
    const task = service.createTask('owner', 'Conversation')
    const app = await service.openApp(task, 'app')
    MockMainPreferenceServiceUtils.simulateExternalPreferenceChange('app.computer_use.agent_control.enabled', false)
    await expect(
      service.act(task, { appSessionId: app.id, snapshotId: 'snapshot', elementId: 'button', type: 'click' })
    ).rejects.toBeInstanceOf(Error)
    await vi.waitFor(() => expect(native.events).toEqual(['open:app', 'close']))
    MockMainPreferenceServiceUtils.simulateExternalPreferenceChange('app.computer_use.agent_control.enabled', true)
    await expect(service.openApp(service.createTask('owner', 'Conversation'), 'app')).rejects.toMatchObject({
      code: 'USER_STOPPED'
    })
    await service.stop()
  })

  it('cancels and closes owned resources when the task signal ends', async () => {
    const abort = new AbortController()
    const native = backend()
    vi.mocked(ComputerUse.start).mockResolvedValue(native.client)
    const service = new TestService()
    const task = service.createTask('owner', 'Conversation', abort.signal)
    await service.openApp(task, 'app')
    abort.abort()
    await service.finishTask(task)
    expect(native.events).toEqual(['open:app', 'close'])
    expect(service.getControls()).toEqual([])
    await expect(service.listApps(task)).rejects.toMatchObject({ code: 'TASK_CLOSED' })
  })
})
