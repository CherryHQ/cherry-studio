import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ChannelManager: {
      pause: () => ({ dispose: () => {} }),
      drainInFlight: async () => ({ stragglerIds: [] }),
      listActiveWork: () => []
    },
    AgentSessionDeliveryService: { listActiveWork: () => [] },
    AgentSessionRuntimeService: { listActiveWork: () => [] }
  } as never)
})

const { AgentLifecycleService } = await import('../AgentLifecycleService')

function fakeIngress() {
  const state = { paused: 0, busy: false }
  return {
    state,
    pause: () => {
      state.paused++
      return { dispose: () => void state.paused-- }
    },
    drainInFlight: async () => ({ stragglerIds: state.busy ? ['remote-access:phone'] : [] }),
    listActiveWork: () => (state.busy ? [{ id: 'remote-access:phone', summary: 'Remote Agent request' }] : [])
  }
}

describe('registered Agent ingress joins backup quiescence', () => {
  beforeEach(() => BaseService.resetInstances())

  it('holds a registered ingress for exactly as long as the ingress hold lives', () => {
    const service = new AgentLifecycleService()
    const ingress = fakeIngress()
    service.registerIngress(ingress)

    const hold = service.pauseIngress('backup')
    expect(ingress.state.paused).toBe(1)
    hold.dispose()
    hold.dispose()
    expect(ingress.state.paused).toBe(0)
  })

  it('reports a registered ingress that did not drain as a straggler and as active work', async () => {
    const service = new AgentLifecycleService()
    const ingress = fakeIngress()
    service.registerIngress(ingress)
    ingress.state.busy = true

    expect(await service.drainIngress({ timeoutMs: 10 })).toEqual({ stragglerIds: ['remote-access:phone'] })
    expect(service.listActiveWork()).toContainEqual({ id: 'remote-access:phone', summary: 'Remote Agent request' })
  })

  it('stops holding an ingress once it unregisters', () => {
    const service = new AgentLifecycleService()
    const ingress = fakeIngress()
    service.registerIngress(ingress).dispose()

    service.pauseIngress('backup')
    expect(ingress.state.paused).toBe(0)
  })
})
