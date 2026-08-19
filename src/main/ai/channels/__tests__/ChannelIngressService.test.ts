import { BaseService, SERVICE_STOP_TIMEOUT_MS, type ServiceConstructor } from '@main/core/lifecycle'
import { getDependencies } from '@main/core/lifecycle/decorators'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, startMock, pauseMock, drainInFlightMock, disposeShutdownHoldMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  startMock: vi.fn(),
  pauseMock: vi.fn(),
  drainInFlightMock: vi.fn(),
  disposeShutdownHoldMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: appGetMock }
}))

const { ChannelIngressService } = await import('../ChannelIngressService')
const { ConversationRuntimeService } = await import('../../conversation')
const { JobManager } = await import('../../../core/job/JobManager')

type ChannelIngressServiceInternals = {
  onReady(): Promise<void>
  onStop(): Promise<void>
}

function createService(): ChannelIngressServiceInternals {
  BaseService.resetInstances()
  return new ChannelIngressService() as unknown as ChannelIngressServiceInternals
}

beforeEach(() => {
  vi.clearAllMocks()
  startMock.mockResolvedValue(undefined)
  pauseMock.mockReturnValue({ dispose: disposeShutdownHoldMock })
  drainInFlightMock.mockResolvedValue({ stragglerIds: [] })
  appGetMock.mockImplementation((name: string) => {
    if (name === 'ChannelManager') {
      return {
        start: startMock,
        pause: pauseMock,
        drainInFlight: drainInFlightMock
      }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('Channel lifecycle ordering', () => {
  it('keeps terminal delivery alive until stream and job producers stop', () => {
    expect(getDependencies(ConversationRuntimeService as unknown as ServiceConstructor)).toContain('ChannelManager')
    expect(getDependencies(JobManager)).toContain('ChannelManager')
    expect(getDependencies(ChannelIngressService)).toEqual(['ChannelManager', 'AiService', 'AgentConnectionManager'])
  })

  it('opens intake after dependencies are ready', async () => {
    const service = createService()

    await service.onReady()

    expect(startMock).toHaveBeenCalledOnce()
  })

  it('quiesces and drains intake without releasing the shutdown hold', async () => {
    const service = createService()

    await service.onStop()

    expect(pauseMock).toHaveBeenCalledWith('application-shutdown')
    expect(drainInFlightMock).toHaveBeenCalledWith({ timeoutMs: SERVICE_STOP_TIMEOUT_MS - 500 })
    expect(pauseMock.mock.invocationCallOrder[0]).toBeLessThan(drainInFlightMock.mock.invocationCallOrder[0])
    expect(disposeShutdownHoldMock).not.toHaveBeenCalled()
  })
})
