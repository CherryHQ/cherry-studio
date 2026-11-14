import { afterEach, describe, expect, it, vi } from 'vitest'

import { MINI_APP_REGIONS } from '@shared/types/miniAppRegion'

import { RegionEmulation } from '../session/RegionEmulation'
import { createGuest } from './guestFixture'

const regions: RegionEmulation[] = []

afterEach(() => {
  regions.splice(0).forEach((region) => region.dispose())
})

function setup(options: { locale?: string; context?: 'existing' | 'after-resume' | 'none' } = {}) {
  const { guest, mock } = createGuest()
  const transport = mock.debugger
  const state = { failed: false, runtimeEnabled: false, checked: false, scriptStarted: false }
  const overrides = new Set<string>()
  let contextAvailable = false
  const contextCreated = (id: number, sessionId = 'frame', isDefault = true) => {
    if (sessionId === 'frame' && isDefault) contextAvailable = true
    transport.emit(
      'message',
      {},
      'Runtime.executionContextCreated',
      { context: { id, auxData: { isDefault } } },
      sessionId
    )
  }
  transport.sendCommand.mockImplementation(async (method, params, sessionId?: string) => {
    if (sessionId !== 'frame') return {}
    if (method === 'Emulation.setLocaleOverride') throw new Error('Another locale override is already in effect')
    if (method.startsWith('Emulation.')) overrides.add(method)
    if (method === 'Runtime.enable') {
      state.runtimeEnabled = true
      contextCreated(12, 'unrelated-frame')
      contextCreated(13, 'frame', false)
      if (options.context === 'existing') contextCreated(42)
    }
    if (method === 'Runtime.runIfWaitingForDebugger') {
      state.scriptStarted = true
      if (options.context === 'after-resume') contextCreated(42)
    }
    if (method === 'Runtime.evaluate') {
      if (!contextAvailable) throw new Error('Cannot find default execution context')
      if ((params as { contextId?: number }).contextId !== 42) throw new Error('Wrong execution context')
      state.checked = true
      return { result: { value: options.locale ?? 'en-US' } }
    }
    return {}
  })
  const region = new RegionEmulation(guest, MINI_APP_REGIONS.US, () => {
    state.failed = true
  })
  regions.push(region)
  transport.attach()
  const attachFrame = () =>
    transport.emit('message', {}, 'Target.attachedToTarget', {
      sessionId: 'frame',
      targetInfo: { type: 'iframe' },
      waitingForDebugger: true
    })
  return { region, state, overrides, transport, attachFrame, contextCreated }
}

async function setupPendingChild(targetType: string) {
  const { guest, mock } = createGuest()
  const failure = vi.fn()
  let rejectOverride!: (error: Error) => void
  const pendingOverride = new Promise((_, reject) => {
    rejectOverride = reject
  })
  const resumed: string[] = []
  mock.debugger.sendCommand.mockImplementation(async (method, _params, sessionId?: string) => {
    if (sessionId === 'child' && method === 'Emulation.setTimezoneOverride') return pendingOverride
    if (method === 'Runtime.runIfWaitingForDebugger' && sessionId) resumed.push(sessionId)
    return {}
  })
  const region = new RegionEmulation(guest, MINI_APP_REGIONS.US, failure)
  regions.push(region)
  mock.debugger.attach()
  await region.start()
  mock.debugger.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'child',
    targetInfo: { type: targetType },
    waitingForDebugger: true
  })
  return { region, transport: mock.debugger, failure, rejectOverride, resumed }
}

describe('Regional child target teardown', () => {
  it.each(['iframe', 'worker'])(
    'keeps the parent usable when a %s vanishes during pending overrides',
    async (targetType) => {
      const { transport, failure, rejectOverride, resumed } = await setupPendingChild(targetType)
      transport.emit('message', {}, 'Target.detachedFromTarget', { sessionId: 'child' })
      rejectOverride(new Error('Session with given id not found'))
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(failure).not.toHaveBeenCalled()
      expect(resumed).not.toContain('child')
      transport.emit('message', {}, 'Target.attachedToTarget', {
        sessionId: 'sibling',
        targetInfo: { type: 'worker' },
        waitingForDebugger: true
      })
      await vi.waitFor(() => expect(resumed).toContain('sibling'))
    }
  )

  it('fails closed for a still-live child even when its error looks like a vanished session', async () => {
    const { failure, rejectOverride } = await setupPendingChild('worker')
    rejectOverride(new Error('Session with given id not found'))
    await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce())
  })

  it('does not resume pending child work after disposal', async () => {
    const { region, failure, rejectOverride, resumed } = await setupPendingChild('iframe')
    region.dispose()
    rejectOverride(new Error('Session with given id not found'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(failure).not.toHaveBeenCalled()
    expect(resumed).not.toContain('child')
  })
})

describe('Regional locale validation', () => {
  it('leaves hardware concurrency native in both the page and child workers', async () => {
    const { guest, mock } = createGuest()
    let resumed = false
    let hardwareOverride = false
    mock.debugger.sendCommand.mockImplementation(async (method) => {
      if (method === 'Emulation.setHardwareConcurrencyOverride') {
        hardwareOverride = true
        throw new Error('Hardware concurrency must remain native')
      }
      if (method === 'Runtime.runIfWaitingForDebugger') resumed = true
      return {}
    })
    const region = new RegionEmulation(guest, MINI_APP_REGIONS.US, () => {
      throw new Error('Unexpected regional failure')
    })
    regions.push(region)
    mock.debugger.attach()
    await region.start()
    mock.debugger.emit('message', {}, 'Target.attachedToTarget', {
      sessionId: 'worker',
      targetInfo: { type: 'worker' },
      waitingForDebugger: true
    })
    await vi.waitFor(() => expect(resumed).toBe(true))
    expect(hardwareOverride).toBe(false)
  })

  it('accepts Electron main-target context events with an empty session ID', async () => {
    const { guest, mock } = createGuest()
    let checked = false
    mock.debugger.sendCommand.mockImplementation(async (method) => {
      if (method === 'Emulation.setLocaleOverride') throw new Error('Another locale override is already in effect')
      if (method === 'Runtime.enable') {
        mock.debugger.emit(
          'message',
          {},
          'Runtime.executionContextCreated',
          { context: { id: 42, auxData: { isDefault: true } } },
          ''
        )
      }
      if (method === 'Runtime.evaluate') {
        checked = true
        return { result: { value: 'en-US' } }
      }
      return {}
    })
    const region = new RegionEmulation(guest, MINI_APP_REGIONS.US, () => {
      throw new Error('Unexpected regional failure')
    })
    regions.push(region)
    mock.debugger.attach()
    await region.start()
    expect(checked).toBe(true)
  })

  it('lets a new iframe create its context after applying native overrides, then verifies the inherited locale', async () => {
    const { region, state, overrides, attachFrame } = setup({ context: 'after-resume' })
    await region.start()
    attachFrame()
    await vi.waitFor(() => expect(state.checked).toBe(true))
    expect(state.failed).toBe(false)
    expect(state.scriptStarted).toBe(true)
    expect(overrides).toEqual(
      new Set(['Emulation.setUserAgentOverride', 'Emulation.setTimezoneOverride', 'Emulation.setGeolocationOverride'])
    )
  })

  it('still fails when the existing renderer has a conflicting locale', async () => {
    const { region, state, attachFrame } = setup({ context: 'existing', locale: 'zh-CN' })
    await region.start()
    attachFrame()
    await vi.waitFor(() => expect(state.failed).toBe(true))
    expect(state.checked).toBe(true)
  })

  it('releases a waiting check when the iframe disappears without failing its parent', async () => {
    const { region, state, transport, attachFrame } = setup({ context: 'none' })
    await region.start()
    const listeners = transport.listenerCount('message')
    attachFrame()
    await vi.waitFor(() => expect(state.runtimeEnabled).toBe(true))
    transport.emit('message', {}, 'Target.detachedFromTarget', { sessionId: 'frame' })
    await vi.waitFor(() => expect(transport.listenerCount('message')).toBe(listeners))
    expect(state.failed).toBe(false)
    expect(state.checked).toBe(false)
  })

  it('cancels pending context waits when regional emulation is disposed', async () => {
    const { region, state, transport, attachFrame, contextCreated } = setup({ context: 'none' })
    await region.start()
    attachFrame()
    await vi.waitFor(() => expect(state.runtimeEnabled).toBe(true))
    region.dispose()
    await vi.waitFor(() => expect(transport.listenerCount('message')).toBe(0))
    contextCreated(42)
    expect(state.failed).toBe(false)
    expect(state.checked).toBe(false)
  })
})
