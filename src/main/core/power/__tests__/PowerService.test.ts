import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const PREF_KEY = 'app.power.prevent_sleep_when_busy'

// Hoisted so the vi.mock factories below can close over them. The PowerService test
// uses the REAL lifecycle (real Emitter/Event/BaseService) and the unified global
// mocks for @application / @logger / PreferenceService; only electron + platform +
// the Windows shutdown lib are mocked locally here.
const {
  platformMock,
  powerMonitorListeners,
  powerMonitorOn,
  powerMonitorRemoveListener,
  getSystemIdleTimeMock,
  getSystemIdleStateMock,
  powerMonitorState,
  blockerState,
  psbStart,
  psbStop,
  psbIsStarted,
  shutdownHandlerOn,
  setWindowHandle,
  releaseShutdown,
  blockShutdown,
  windowDestroy,
  windowIsDestroyed,
  getNativeWindowHandle
} = vi.hoisted(() => {
  const powerMonitorListeners = new Map<string, (...args: any[]) => unknown>()
  const blockerState = { started: new Set<number>(), nextId: 1 }
  return {
    platformMock: { isMac: true, isWin: false, isLinux: false },
    powerMonitorListeners,
    powerMonitorOn: vi.fn((event: string, listener: (...a: any[]) => unknown) => {
      powerMonitorListeners.set(event, listener)
    }),
    powerMonitorRemoveListener: vi.fn((event: string) => {
      powerMonitorListeners.delete(event)
    }),
    getSystemIdleTimeMock: vi.fn(() => 0),
    getSystemIdleStateMock: vi.fn(() => 'active'),
    powerMonitorState: { onBatteryPower: false },
    blockerState,
    psbStart: vi.fn(() => {
      const id = blockerState.nextId++
      blockerState.started.add(id)
      return id
    }),
    psbStop: vi.fn((id: number) => {
      blockerState.started.delete(id)
    }),
    psbIsStarted: vi.fn((id: number) => blockerState.started.has(id)),
    shutdownHandlerOn: vi.fn(),
    setWindowHandle: vi.fn(),
    releaseShutdown: vi.fn(),
    blockShutdown: vi.fn(),
    windowDestroy: vi.fn(),
    windowIsDestroyed: vi.fn(() => false),
    getNativeWindowHandle: vi.fn(() => Buffer.alloc(0))
  }
})

vi.mock('@main/core/platform', () => platformMock)

vi.mock('electron', () => ({
  app: {
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/mock')
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn()
  },
  BrowserWindow: vi.fn(() => ({
    destroy: windowDestroy,
    isDestroyed: windowIsDestroyed,
    getNativeWindowHandle
  })),
  powerMonitor: {
    on: powerMonitorOn,
    removeListener: powerMonitorRemoveListener,
    getSystemIdleTime: getSystemIdleTimeMock,
    getSystemIdleState: getSystemIdleStateMock,
    get onBatteryPower() {
      return powerMonitorState.onBatteryPower
    }
  },
  powerSaveBlocker: { start: psbStart, stop: psbStop, isStarted: psbIsStarted }
}))

vi.mock('@paymoapp/electron-shutdown-handler', () => ({
  default: { on: shutdownHandlerOn, setWindowHandle, releaseShutdown, blockShutdown }
}))

// Imported after the mocks are declared.
const { PowerService } = await import('../PowerService')

const quitMock = () => application.quit as unknown as Mock

const fire = (event: string, ...args: any[]) => {
  const listener = powerMonitorListeners.get(event)
  if (!listener) throw new Error(`No listener registered for '${event}'`)
  return listener(...args)
}

async function createInitedService() {
  const service = new PowerService()
  await (service as any).onInit()
  return service
}

describe('PowerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    BaseService.resetInstances()
    powerMonitorListeners.clear()
    blockerState.started.clear()
    blockerState.nextId = 1
    powerMonitorState.onBatteryPower = false
    platformMock.isMac = true
    platformMock.isWin = false
    platformMock.isLinux = false
  })

  describe('power notification events', () => {
    it('fires onSuspend only on a real active→suspended transition (dedups macOS double-fire)', async () => {
      const service = await createInitedService()
      const spy = vi.fn()
      service.onSuspend(spy)

      fire('suspend')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(service.getPowerPhase()).toBe('suspended')

      fire('suspend') // duplicate — already suspended, must not re-fire
      expect(spy).toHaveBeenCalledTimes(1)

      fire('resume')
      fire('suspend')
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('fires onResume only when transitioning back from suspended', async () => {
      const service = await createInitedService()
      const spy = vi.fn()
      service.onResume(spy)

      fire('resume') // never suspended — no transition
      expect(spy).not.toHaveBeenCalled()

      fire('suspend')
      fire('resume')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(service.getPowerPhase()).toBe('active')
    })

    it('forwards lock/unlock screen events as pass-through (no state machine)', async () => {
      const service = await createInitedService()
      const lockSpy = vi.fn()
      const unlockSpy = vi.fn()
      service.onLockScreen(lockSpy)
      service.onUnlockScreen(unlockSpy)

      fire('lock-screen')
      fire('lock-screen')
      fire('unlock-screen')

      expect(lockSpy).toHaveBeenCalledTimes(2)
      expect(unlockSpy).toHaveBeenCalledTimes(1)
    })

    it('seeds power source from onBatteryPower and fires only on real changes', async () => {
      const service = await createInitedService()
      const spy = vi.fn()
      service.onPowerSourceChange(spy)

      expect(service.getPowerSource()).toBe('ac') // seeded from onBatteryPower=false

      fire('on-battery')
      expect(spy).toHaveBeenNthCalledWith(1, 'battery')
      expect(service.getPowerSource()).toBe('battery')

      fire('on-battery') // duplicate — no change
      expect(spy).toHaveBeenCalledTimes(1)

      fire('on-ac')
      expect(spy).toHaveBeenNthCalledWith(2, 'ac')
      expect(service.getPowerSource()).toBe('ac')
    })

    it('seeds power source as battery when onBatteryPower is true at init', async () => {
      powerMonitorState.onBatteryPower = true
      const service = await createInitedService()
      expect(service.getPowerSource()).toBe('battery')
    })
  })

  describe('shutdown barrier (macOS/Linux)', () => {
    it('registers a shutdown listener and quits after running handlers', async () => {
      const service = await createInitedService()
      const handler = vi.fn()
      service.registerShutdownHandler(handler)

      const event = { preventDefault: vi.fn() }
      await fire('shutdown', event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
      expect(quitMock()).toHaveBeenCalledTimes(1)
    })

    it('runs all handlers even if one throws, then quits', async () => {
      const service = await createInitedService()
      const failing = vi.fn().mockRejectedValue(new Error('boom'))
      const ok = vi.fn()
      service.registerShutdownHandler(failing)
      service.registerShutdownHandler(ok)

      await fire('shutdown', { preventDefault: vi.fn() })

      expect(failing).toHaveBeenCalled()
      expect(ok).toHaveBeenCalled()
      expect(quitMock()).toHaveBeenCalledTimes(1)
    })

    it('force-quits when a handler hangs past the timeout', async () => {
      vi.useFakeTimers()
      try {
        const service = await createInitedService()
        service.registerShutdownHandler(() => new Promise<void>(() => {})) // never resolves

        const pending = fire('shutdown', { preventDefault: vi.fn() })
        await vi.advanceTimersByTimeAsync(5000)
        await pending

        expect(quitMock()).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('registerShutdownHandler returns a Disposable that unregisters the handler', async () => {
      const service = await createInitedService()
      const handler = vi.fn()
      const disposable = service.registerShutdownHandler(handler)
      disposable.dispose()

      await fire('shutdown', { preventDefault: vi.fn() })
      expect(handler).not.toHaveBeenCalled()
      expect(quitMock()).toHaveBeenCalledTimes(1)
    })
  })

  describe('shutdown barrier (Windows)', () => {
    beforeEach(() => {
      platformMock.isMac = false
      platformMock.isWin = true
    })

    it('blocks shutdown, then runs handlers, releases the block and quits', async () => {
      const service = await createInitedService()
      const handler = vi.fn()
      service.registerShutdownHandler(handler)

      expect(setWindowHandle).toHaveBeenCalled()
      expect(shutdownHandlerOn).toHaveBeenCalledWith('shutdown', expect.any(Function))
      // The block must actually be requested — otherwise the addon only observes the
      // event and does not hold the OS (the v1 gap this path now closes).
      expect(blockShutdown).toHaveBeenCalledTimes(1)

      const winCallback = shutdownHandlerOn.mock.calls[0][1] as () => Promise<void>
      await winCallback()

      expect(handler).toHaveBeenCalled()
      expect(releaseShutdown).toHaveBeenCalledTimes(1)
      expect(quitMock()).toHaveBeenCalledTimes(1)
    })
  })

  describe('sleep prevention', () => {
    it('does not start a blocker while the preference is disabled', async () => {
      const service = await createInitedService() // pref defaults to false
      const hold = service.preventSleep('job:test')

      expect(psbStart).not.toHaveBeenCalled()
      expect(service.isPreventingSleep()).toBe(false)
      hold.dispose()
    })

    it('starts the blocker once a hold is held and the preference is enabled', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, true)
      const service = await createInitedService()

      expect(psbStart).not.toHaveBeenCalled() // enabled, but no hold yet
      const hold = service.preventSleep('job:test')

      expect(psbStart).toHaveBeenCalledTimes(1)
      expect(psbStart).toHaveBeenCalledWith('prevent-app-suspension')
      expect(service.isPreventingSleep()).toBe(true)

      hold.dispose()
      expect(psbStop).toHaveBeenCalledTimes(1)
      expect(service.isPreventingSleep()).toBe(false)
    })

    it('keeps a single blocker across multiple holds and stops only after the last release', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, true)
      const service = await createInitedService()

      const a = service.preventSleep('a')
      const b = service.preventSleep('b')
      expect(psbStart).toHaveBeenCalledTimes(1)

      a.dispose()
      expect(psbStop).not.toHaveBeenCalled() // b still holds
      b.dispose()
      expect(psbStop).toHaveBeenCalledTimes(1)
    })

    it('dispose is idempotent', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, true)
      const service = await createInitedService()

      const hold = service.preventSleep('once')
      hold.dispose()
      hold.dispose()

      expect(psbStop).toHaveBeenCalledTimes(1)
    })

    it('never throws and still returns a usable Disposable when powerSaveBlocker fails', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, true)
      psbStart.mockImplementationOnce(() => {
        throw new Error('powerSaveBlocker boom')
      })
      const service = await createInitedService()

      // The OS-blocker failure must not propagate to the caller...
      let hold!: { dispose: () => void }
      expect(() => {
        hold = service.preventSleep('job:resilient')
      }).not.toThrow()
      // ...and a usable, disposable hold is still handed back (no consumer guard needed).
      expect(hold).toBeDefined()
      expect(() => hold.dispose()).not.toThrow()
    })

    it('releases the blocker immediately when the preference is turned off mid-hold', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, true)
      const service = await createInitedService()
      service.preventSleep('job')
      expect(psbStart).toHaveBeenCalledTimes(1)

      // Simulate the user toggling the preference off — drives the subscribeChange callback.
      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, false)
      expect(psbStop).toHaveBeenCalledTimes(1)
      expect(service.isPreventingSleep()).toBe(false)
    })

    it('starts the blocker when the preference flips on while a hold is held', async () => {
      const service = await createInitedService() // disabled
      service.preventSleep('job')
      expect(psbStart).not.toHaveBeenCalled()

      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, true)
      expect(psbStart).toHaveBeenCalledTimes(1)
    })
  })

  describe('queries', () => {
    it('forwards idle queries to powerMonitor', async () => {
      getSystemIdleTimeMock.mockReturnValue(42)
      getSystemIdleStateMock.mockReturnValue('idle')
      const service = await createInitedService()

      expect(service.getSystemIdleTime()).toBe(42)
      expect(service.getSystemIdleState(60)).toBe('idle')
      expect(getSystemIdleStateMock).toHaveBeenCalledWith(60)
    })

    it('forwards isOnBatteryPower to powerMonitor', async () => {
      powerMonitorState.onBatteryPower = true
      const service = await createInitedService()
      expect(service.isOnBatteryPower()).toBe(true)
    })
  })

  describe('onStop', () => {
    it('stops an active blocker and clears holds', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(PREF_KEY, true)
      const service = await createInitedService()
      service.preventSleep('job')
      expect(psbStart).toHaveBeenCalledTimes(1)

      await (service as any).onStop()
      expect(psbStop).toHaveBeenCalledTimes(1)
      expect(service.isPreventingSleep()).toBe(false)
    })
  })
})
