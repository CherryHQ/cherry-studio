import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ComputerUse, type ComputerUseClient } from '@cherrystudio/computer-use'
import type * as ComputerUseModule from '@cherrystudio/computer-use'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle'

import { ComputerUseService } from '../ComputerUseService'

vi.mock('@cherrystudio/computer-use', async (original) => ({
  ...(await original<typeof ComputerUseModule>()),
  ComputerUse: { start: vi.fn() }
}))

const app = { id: 'pid:1', name: 'Editor', identity: 'com.example.editor' }
let service: ComputerUseService
let effects: string[]
let running: boolean
let bypass: boolean
let client: ComputerUseClient
const authorization = {
  current: () => ({ sessionId: 'session', topicId: 'agent-session:session', windowId: 'window', bypass }),
  waiting: () => {}
}
beforeEach(() => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  effects = []
  running = true
  bypass = false
  client = {
    listApps: async () => (running ? [app] : []),
    resolveAppIdentity: async () => ({ id: app.identity, name: app.name, query: app.identity }),
    resolveApp: async () => {
      effects.push('launch')
      return app
    },
    openAppSession: async () => {
      effects.push('open')
      return { id: 'native', app, status: 'active' }
    },
    getAppState: async () => {
      effects.push('read')
      return {}
    },
    act: async () => {
      effects.push('input')
      return {}
    },
    stopAppSession: async () => ({ status: 'stopped', cleanup: 'complete' }),
    onClosed: () => () => {},
    close: async () => {}
  } as unknown as ComputerUseClient
  vi.mocked(ComputerUse.start).mockResolvedValue(client)
  service = new ComputerUseService()
})
afterEach(async () => {
  toolApprovalRegistry.clear()
  await service._doStop()
})

async function respond(scope: 'always' | 'session' | 'reject') {
  await vi.waitFor(() => expect(service.approvals.list('window')).toHaveLength(1))
  const [{ approvalId }] = service.approvals.list('window')
  expect(service.approvals.respond(approvalId, scope, 'window')).toBe(true)
}

describe('native application authorization boundary', () => {
  it.each([true, false])('rejects before native launch, control or observation (running: %s)', async (isRunning) => {
    running = isRunning
    const task = service.createTask('owner', 'Agent', undefined, authorization)
    const result = service.resolveApp(task, 'Editor')
    const rejected = expect(result).rejects.toThrow('rejected')
    await respond('reject')
    await rejected
    expect(effects).toEqual([])
  })

  it('applies session consent across turns and rechecks Always revocation on an open handle', async () => {
    const task = service.createTask('owner', 'Agent', undefined, authorization)
    const opening = service.resolveApp(task, 'Editor')
    await respond('session')
    const opened = await opening
    await service.getAppState(task, { appSessionId: opened.id })
    await service.finishTask(task)
    const nextTask = service.createTask('owner', 'Agent', undefined, authorization)
    await service.resolveApp(nextTask, 'Editor')
    expect(service.approvals.list('window')).toEqual([])
    service.approvals.clear('owner')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.approved_apps', [app.identity])
    await service.getAppState(nextTask, { appSessionId: 'native' })
    MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.approved_apps', [])
    const before = effects.slice()
    const read = service.getAppState(nextTask, { appSessionId: 'native' })
    const rejected = expect(read).rejects.toThrow('rejected')
    await respond('reject')
    await rejected
    expect(effects).toEqual(before)
  })

  it('bypass skips consent but still enforces the user stop and disabled setting', async () => {
    bypass = true
    const task = service.createTask('owner', 'Agent', undefined, authorization)
    await service.resolveApp(task, 'Editor')
    expect(service.approvals.list('window')).toEqual([])
    await service.stopApp('owner', app.id)
    await expect(service.resolveApp(task, 'Editor')).rejects.toMatchObject({ code: 'USER_STOPPED' })
    MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', false)
    const other = service.createTask('other', 'Other', undefined, authorization)
    await expect(service.resolveApp(other, 'Editor')).rejects.toMatchObject({ code: 'CONTROL_DISABLED' })
  })

  it('does not resume native work or save consent when the task is cancelled while asking', async () => {
    const abort = new AbortController()
    const task = service.createTask('owner', 'Agent', abort.signal, authorization)
    const opening = service.resolveApp(task, 'Editor')
    const rejected = expect(opening).rejects.toThrow()
    await vi.waitFor(() => expect(service.approvals.list('window')).toHaveLength(1))
    const [{ approvalId }] = service.approvals.list('window')
    abort.abort()
    expect(service.approvals.respond(approvalId, 'always', 'window')).toBe(false)
    await rejected
    expect(effects).toEqual([])
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.computer_use.approved_apps')).toEqual([])
  })
})
