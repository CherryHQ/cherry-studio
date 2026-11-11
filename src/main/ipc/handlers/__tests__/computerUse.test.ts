import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComputerUse, type ComputerUseClient } from '@cherrystudio/computer-use'
import type * as ComputerUseModule from '@cherrystudio/computer-use'
import { BaseService } from '@main/core/lifecycle'
import { IpcRouter } from '@main/ipc/IpcRouter'
import { ComputerUseService } from '@main/services/ComputerUseService'
import { computerUseRequestSchemas } from '@shared/ipc/schemas/computerUse'

import { computerUseHandlers } from '../computerUse'

vi.mock('@cherrystudio/computer-use', async (original) => ({
  ...(await original<typeof ComputerUseModule>()),
  ComputerUse: { start: vi.fn() }
}))

beforeEach(() => {
  BaseService.resetInstances()
  MockApplicationUtils.resetServices()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', true)
  const client = {
    openAppSession: async ({ appId }: { appId: string }) => ({
      id: appId,
      app: { id: appId, name: appId },
      status: 'active'
    }),
    stopAppSession: async ({ appSessionId }: { appSessionId: string }) => ({
      appSessionId,
      status: 'stopped',
      cleanup: 'complete'
    }),
    onClosed: () => () => {},
    close: async () => {}
  } as unknown as ComputerUseClient
  vi.mocked(ComputerUse.start).mockResolvedValue(client)
})

describe('computer-use control routes', () => {
  it('projects and controls real service state with strict stop-app validation', async () => {
    const service = new ComputerUseService()
    MockApplicationUtils.setService('ComputerUseService', service)
    const router = new IpcRouter(computerUseRequestSchemas, computerUseHandlers)
    const request = (route: string, input?: unknown) => router.dispatch(route, input, { senderId: null })
    const owner = 'agent:session:agent'
    const task = service.createTask(owner, 'Conversation')
    await service.openApp(task, 'first')
    await service.openApp(task, 'second')
    const before = service.getControls()
    expect(await request('computer_use.get_controls')).toEqual(before)
    for (const input of [
      { ownerId: owner },
      { ownerId: owner, appId: '' },
      { ownerId: '', appId: 'first' },
      { ownerId: owner, appId: 'first', extra: true }
    ]) {
      await expect(request('computer_use.stop_app', input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      expect(service.getControls()).toEqual(before)
    }
    await request('computer_use.stop_app', { ownerId: owner, appId: 'first' })
    await expect(service.openApp(task, 'first')).rejects.toMatchObject({ code: 'USER_STOPPED' })
    await expect(service.openApp(task, 'second')).resolves.toMatchObject({ status: 'active' })
    const other = service.createTask('agent:other:agent', 'Other')
    await service.openApp(other, 'third')
    await request('computer_use.stop_all')
    expect(await request('computer_use.get_controls')).toEqual(service.getControls())
    expect(service.getControls()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerId: owner, status: 'stopped' }),
        expect.objectContaining({ ownerId: 'agent:other:agent', status: 'stopped' })
      ])
    )
    await expect(service.openApp(service.createTask(owner, 'Conversation'), 'second')).rejects.toMatchObject({
      code: 'USER_STOPPED'
    })
    await expect(service.openApp(service.createTask('agent:other:agent', 'Other'), 'third')).rejects.toMatchObject({
      code: 'USER_STOPPED'
    })
  })
})
