import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../BaseService'
import { LifecycleState } from '../types'

describe('BaseService', () => {
  describe('initial state', () => {
    it('should start in Created state', () => {
      class TestService extends BaseService {}
      const service = new TestService()
      expect(service.state).toBe(LifecycleState.Created)
    })

    it('should not be ready, destroyed, paused, or stopped initially', () => {
      class TestService extends BaseService {}
      const service = new TestService()
      expect(service.isReady).toBe(false)
      expect(service.isDestroyed).toBe(false)
      expect(service.isPaused).toBe(false)
      expect(service.isStopped).toBe(false)
    })
  })

  describe('singleton guard', () => {
    it('should prevent duplicate instantiation of the same class', () => {
      class SingletonTestService extends BaseService {}
      new SingletonTestService()
      expect(() => new SingletonTestService()).toThrow('has already been instantiated')
    })
  })

  describe('_doInit lifecycle', () => {
    it('should transition Created -> Initializing -> Ready', async () => {
      class InitService extends BaseService {
        public statesDuringInit: LifecycleState[] = []
        protected override async onInit(): Promise<void> {
          this.statesDuringInit.push(this.state)
        }
        protected override async onReady(): Promise<void> {
          this.statesDuringInit.push(this.state)
        }
      }

      const service = new InitService()
      await service._doInit()

      expect(service.statesDuringInit[0]).toBe(LifecycleState.Initializing)
      expect(service.statesDuringInit[1]).toBe(LifecycleState.Ready)
      expect(service.state).toBe(LifecycleState.Ready)
      expect(service.isReady).toBe(true)
    })

    it('should call onInit then onReady in order', async () => {
      const calls: string[] = []
      class OrderService extends BaseService {
        protected override onInit() {
          calls.push('onInit')
        }
        protected override onReady() {
          calls.push('onReady')
        }
      }

      const service = new OrderService()
      await service._doInit()
      expect(calls).toEqual(['onInit', 'onReady'])
    })
  })

  describe('_doStop lifecycle', () => {
    it('should transition to Stopped state', async () => {
      class StopService extends BaseService {}
      const service = new StopService()
      await service._doInit()
      await service._doStop()

      expect(service.state).toBe(LifecycleState.Stopped)
      expect(service.isStopped).toBe(true)
    })

    it('should call onStop hook', async () => {
      const onStop = vi.fn()
      class StopHookService extends BaseService {
        protected override onStop = onStop
      }

      const service = new StopHookService()
      await service._doInit()
      await service._doStop()
      expect(onStop).toHaveBeenCalledOnce()
    })
  })

  describe('_doDestroy lifecycle', () => {
    it('should transition to Destroyed state', async () => {
      class DestroyService extends BaseService {}
      const service = new DestroyService()
      await service._doInit()
      await service._doDestroy()

      expect(service.state).toBe(LifecycleState.Destroyed)
      expect(service.isDestroyed).toBe(true)
    })

    it('should call onDestroy hook', async () => {
      const onDestroy = vi.fn()
      class DestroyHookService extends BaseService {
        protected override onDestroy = onDestroy
      }

      const service = new DestroyHookService()
      await service._doInit()
      await service._doDestroy()
      expect(onDestroy).toHaveBeenCalledOnce()
    })
  })

  describe('_doAllReady lifecycle', () => {
    it('should call onAllReady hook', async () => {
      const onAllReady = vi.fn()
      class AllReadyService extends BaseService {
        protected override onAllReady = onAllReady
      }

      const service = new AllReadyService()
      await service._doInit()
      await service._doAllReady()
      expect(onAllReady).toHaveBeenCalledOnce()
    })

    it('should not change service state', async () => {
      class StateCheckService extends BaseService {}
      const service = new StateCheckService()
      await service._doInit()
      expect(service.state).toBe(LifecycleState.Ready)

      await service._doAllReady()
      expect(service.state).toBe(LifecycleState.Ready)
    })

    it('should be a no-op by default (empty hook)', async () => {
      class DefaultService extends BaseService {}
      const service = new DefaultService()
      await service._doInit()
      await expect(service._doAllReady()).resolves.toBeUndefined()
    })

    it('should only execute once even if called multiple times', async () => {
      const onAllReady = vi.fn()
      class OnceService extends BaseService {
        protected override onAllReady = onAllReady
      }

      const service = new OnceService()
      await service._doInit()
      await service._doAllReady()
      await service._doAllReady()
      await service._doAllReady()
      expect(onAllReady).toHaveBeenCalledOnce()
    })
  })

  describe('IPC helpers', () => {
    beforeEach(() => {
      vi.mocked(ipcMain.handle).mockClear()
      vi.mocked(ipcMain.on).mockClear()
      vi.mocked(ipcMain.removeHandler).mockClear()
      vi.mocked(ipcMain.removeListener).mockClear()
    })

    it('ipcHandle() should call ipcMain.handle and track channel', async () => {
      const handler = vi.fn()
      class IpcService extends BaseService {
        protected override async onInit() {
          this.ipcHandle('test-channel', handler)
        }
      }

      const service = new IpcService()
      await service._doInit()

      expect(ipcMain.handle).toHaveBeenCalledWith('test-channel', handler)
    })

    it('ipcOn() should call ipcMain.on and track listener', async () => {
      const listener = vi.fn()
      class IpcService extends BaseService {
        protected override async onInit() {
          this.ipcOn('test-event', listener)
        }
      }

      const service = new IpcService()
      await service._doInit()

      expect(ipcMain.on).toHaveBeenCalledWith('test-event', listener)
    })

    it('_doStop() should auto-cleanup all tracked IPC handlers', async () => {
      class IpcService extends BaseService {
        protected override async onInit() {
          this.ipcHandle('channel-a', vi.fn())
          this.ipcHandle('channel-b', vi.fn())
        }
      }

      const service = new IpcService()
      await service._doInit()
      await service._doStop()

      expect(ipcMain.removeHandler).toHaveBeenCalledWith('channel-a')
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('channel-b')
      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(2)
    })

    it('_doStop() should auto-cleanup all tracked IPC listeners', async () => {
      const listenerA = vi.fn()
      const listenerB = vi.fn()
      class IpcService extends BaseService {
        protected override async onInit() {
          this.ipcOn('event-a', listenerA)
          this.ipcOn('event-b', listenerB)
        }
      }

      const service = new IpcService()
      await service._doInit()
      await service._doStop()

      expect(ipcMain.removeListener).toHaveBeenCalledWith('event-a', listenerA)
      expect(ipcMain.removeListener).toHaveBeenCalledWith('event-b', listenerB)
      expect(ipcMain.removeListener).toHaveBeenCalledTimes(2)
    })

    it('_doDestroy() should cleanup IPC handlers as safety net', async () => {
      class IpcService extends BaseService {
        protected override async onInit() {
          this.ipcHandle('destroy-channel', vi.fn())
        }
      }

      const service = new IpcService()
      await service._doInit()
      // Skip _doStop, go directly to _doDestroy
      await service._doDestroy()

      expect(ipcMain.removeHandler).toHaveBeenCalledWith('destroy-channel')
    })

    it('double cleanup should be safe (no-op on already removed handlers)', async () => {
      class IpcService extends BaseService {
        protected override async onInit() {
          this.ipcHandle('double-channel', vi.fn())
          this.ipcOn('double-event', vi.fn())
        }
      }

      const service = new IpcService()
      await service._doInit()
      await service._doStop()
      // Second cleanup via destroy should not throw
      await service._doDestroy()

      // removeHandler called once in _doStop, once in _doDestroy (on empty array)
      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(1)
    })

    it('should work when no IPC handlers registered', async () => {
      class EmptyService extends BaseService {}

      const service = new EmptyService()
      await service._doInit()
      await service._doStop()

      expect(ipcMain.removeHandler).not.toHaveBeenCalled()
      expect(ipcMain.removeListener).not.toHaveBeenCalled()
    })

    it('restart cycle: init → stop → init → stop should track and cleanup correctly', async () => {
      let callCount = 0
      class RestartService extends BaseService {
        protected override async onInit() {
          callCount++
          this.ipcHandle(`channel-${callCount}`, vi.fn())
        }
      }

      const service = new RestartService()

      // First cycle
      await service._doInit()
      expect(ipcMain.handle).toHaveBeenCalledWith('channel-1', expect.any(Function))
      await service._doStop()
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('channel-1')

      vi.mocked(ipcMain.handle).mockClear()
      vi.mocked(ipcMain.removeHandler).mockClear()

      // Second cycle
      await service._doInit()
      expect(ipcMain.handle).toHaveBeenCalledWith('channel-2', expect.any(Function))
      await service._doStop()
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('channel-2')
      // Should NOT re-remove channel-1
      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(1)
    })

    it('onStop() throwing should still cleanup IPC handlers (try/finally)', async () => {
      class FailingStopService extends BaseService {
        protected override async onInit() {
          this.ipcHandle('fail-channel', vi.fn())
          this.ipcOn('fail-event', vi.fn())
        }
        protected override async onStop() {
          throw new Error('onStop failed')
        }
      }

      const service = new FailingStopService()
      await service._doInit()

      await expect(service._doStop()).rejects.toThrow('onStop failed')

      // IPC cleanup should still have happened
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('fail-channel')
      expect(ipcMain.removeListener).toHaveBeenCalledTimes(1)
    })
  })

  describe('registerInterval', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('fires the callback at the specified interval', async () => {
      const callback = vi.fn()
      class IntervalFiresService extends BaseService {
        protected override async onInit() {
          this.registerInterval(callback, 1000)
        }
      }

      const service = new IntervalFiresService()
      await service._doInit()

      expect(callback).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(callback).toHaveBeenCalledTimes(3)
    })

    it('stops firing after _doStop', async () => {
      const callback = vi.fn()
      class IntervalStopService extends BaseService {
        protected override async onInit() {
          this.registerInterval(callback, 1000)
        }
      }

      const service = new IntervalStopService()
      await service._doInit()
      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(1)

      await service._doStop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('returned Disposable cancels the timer (and is idempotent)', async () => {
      const callback = vi.fn()
      let disposable: { dispose(): void } | undefined

      class IntervalDisposeService extends BaseService {
        protected override async onInit() {
          disposable = this.registerInterval(callback, 1000)
        }
      }

      const service = new IntervalDisposeService()
      await service._doInit()
      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(1)

      disposable!.dispose()
      disposable!.dispose()
      await vi.advanceTimersByTimeAsync(5000)
      expect(callback).toHaveBeenCalledTimes(1)

      await service._doStop()
    })

    it('isolates synchronous callback exceptions and keeps the loop alive', async () => {
      let calls = 0
      const callback = vi.fn(() => {
        calls += 1
        if (calls === 1) {
          throw new Error('boom-sync')
        }
      })

      class IntervalSyncErrService extends BaseService {
        protected override async onInit() {
          this.registerInterval(callback, 1000)
        }
      }

      const service = new IntervalSyncErrService()
      await service._doInit()

      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(2)

      await service._doStop()
    })

    it('isolates async callback rejections and keeps the loop alive', async () => {
      let calls = 0
      const callback = vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          throw new Error('boom-async')
        }
      })

      class IntervalAsyncErrService extends BaseService {
        protected override async onInit() {
          this.registerInterval(callback, 1000)
        }
      }

      const service = new IntervalAsyncErrService()
      await service._doInit()

      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(2)

      await service._doStop()
    })

    it('unrefs the timer handle by default', async () => {
      const unref = vi.fn()
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(
        () =>
          ({
            unref,
            ref: vi.fn(),
            hasRef: vi.fn(),
            refresh: vi.fn(),
            [Symbol.toPrimitive]: () => 0,
            [Symbol.dispose]: () => {}
          }) as unknown as NodeJS.Timeout
      )

      class IntervalUnrefService extends BaseService {
        protected override async onInit() {
          this.registerInterval(vi.fn(), 1000)
        }
      }

      const service = new IntervalUnrefService()
      await service._doInit()

      expect(unref).toHaveBeenCalledTimes(1)

      setIntervalSpy.mockRestore()
      await service._doStop()
    })

    it('restart cycle: timer registered in first init does not survive into second init', async () => {
      let initCount = 0
      const callback = vi.fn()

      class IntervalRestartService extends BaseService {
        protected override async onInit() {
          initCount++
          this.registerInterval(callback, 1000)
        }
      }

      const service = new IntervalRestartService()

      await service._doInit()
      await vi.advanceTimersByTimeAsync(1000)
      expect(callback).toHaveBeenCalledTimes(1)
      await service._doStop()

      await service._doInit()
      await vi.advanceTimersByTimeAsync(1000)
      // Exactly +1 (not +2) — proves old timer was cleared on stop
      expect(callback).toHaveBeenCalledTimes(2)
      expect(initCount).toBe(2)

      await service._doStop()
    })
  })

  describe('registerDisposable cleanup', () => {
    it('should dispose registered disposables on stop', async () => {
      const disposeFn = vi.fn()

      class DisposableService extends BaseService {
        protected override async onInit() {
          this.registerDisposable({ dispose: disposeFn })
        }
      }

      const service = new DisposableService()
      await service._doInit()
      await service._doStop()

      expect(disposeFn).toHaveBeenCalledTimes(1)
    })

    it('should dispose registered disposables on destroy', async () => {
      const disposeFn = vi.fn()

      class DisposableService extends BaseService {
        protected override async onInit() {
          this.registerDisposable({ dispose: disposeFn })
        }
      }

      const service = new DisposableService()
      await service._doInit()
      await service._doDestroy()

      expect(disposeFn).toHaveBeenCalledTimes(1)
    })

    it('should cleanup disposables even when onStop throws', async () => {
      const disposeFn = vi.fn()

      class FailService extends BaseService {
        protected override async onInit() {
          this.registerDisposable({ dispose: disposeFn })
        }
        protected override async onStop() {
          throw new Error('stop failed')
        }
      }

      const service = new FailService()
      await service._doInit()
      await expect(service._doStop()).rejects.toThrow('stop failed')

      expect(disposeFn).toHaveBeenCalledTimes(1)
    })

    it('restart cycle: disposables from first cycle should not leak into second', async () => {
      let cycle = 0
      const dispose1 = vi.fn()
      const dispose2 = vi.fn()

      class RestartDisposableService extends BaseService {
        protected override async onInit() {
          cycle++
          this.registerDisposable({ dispose: cycle === 1 ? dispose1 : dispose2 })
        }
      }

      const service = new RestartDisposableService()

      // First cycle
      await service._doInit()
      await service._doStop()
      expect(dispose1).toHaveBeenCalledTimes(1)

      // Second cycle
      await service._doInit()
      await service._doStop()
      expect(dispose2).toHaveBeenCalledTimes(1)
      // First disposable should not be re-disposed
      expect(dispose1).toHaveBeenCalledTimes(1)
    })

    it('double cleanup should be safe (no-op on empty array)', async () => {
      const disposeFn = vi.fn()

      class DoubleCleanupService extends BaseService {
        protected override async onInit() {
          this.registerDisposable({ dispose: disposeFn })
        }
      }

      const service = new DoubleCleanupService()
      await service._doInit()
      await service._doStop()
      await service._doDestroy()

      expect(disposeFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('registerDisposable overload', () => {
    it('should accept () => void and dispose on stop', async () => {
      const fn = vi.fn()
      class FnService extends BaseService {
        protected override async onInit() {
          this.registerDisposable(fn)
        }
      }
      const service = new FnService()
      await service._doInit()
      await service._doStop()
      expect(fn).toHaveBeenCalledOnce()
    })

    it('should return the disposable for inline assignment', async () => {
      const disposeFn = vi.fn()
      let captured: { dispose(): void } | null = null
      class ReturnService extends BaseService {
        protected override async onInit() {
          captured = this.registerDisposable({ dispose: disposeFn })
        }
      }
      const service = new ReturnService()
      await service._doInit()
      expect(captured).not.toBeNull()
      expect(captured!.dispose).toBe(disposeFn)
    })

    it('should handle mixed Disposable objects and plain functions', async () => {
      const objDispose = vi.fn()
      const plainFn = vi.fn()
      class MixedService extends BaseService {
        protected override async onInit() {
          this.registerDisposable({ dispose: objDispose })
          this.registerDisposable(plainFn)
        }
      }
      const service = new MixedService()
      await service._doInit()
      await service._doStop()
      expect(objDispose).toHaveBeenCalledOnce()
      expect(plainFn).toHaveBeenCalledOnce()
    })
  })

  describe('ipcHandle / ipcOn return Disposable', () => {
    it('should return a Disposable from ipcHandle', async () => {
      let disposable: { dispose(): void } | null = null
      class IpcReturnService extends BaseService {
        protected override async onInit() {
          disposable = this.ipcHandle('test-channel', vi.fn())
        }
      }
      const service = new IpcReturnService()
      await service._doInit()
      expect(disposable).not.toBeNull()
      expect(typeof disposable!.dispose).toBe('function')
    })

    it('should allow early manual unregister via returned Disposable', async () => {
      let disposable: { dispose(): void } | null = null
      class EarlyUnregService extends BaseService {
        protected override async onInit() {
          disposable = this.ipcHandle('early-channel', vi.fn())
        }
      }
      const service = new EarlyUnregService()
      await service._doInit()

      // Manual early unregister
      disposable!.dispose()
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('early-channel')
    })
  })

  describe('_doDestroy idempotency', () => {
    it('should be idempotent — second destroy is a no-op', async () => {
      class DestroyService extends BaseService {}
      const service = new DestroyService()
      await service._doInit()
      await service._doDestroy()
      expect(service.state).toBe(LifecycleState.Destroyed)

      // Second destroy should be a no-op
      await service._doDestroy()
      expect(service.state).toBe(LifecycleState.Destroyed)
    })
  })

  describe('_doPause / _doResume', () => {
    it('should return false for non-Pausable service', async () => {
      class NonPausable extends BaseService {}
      const service = new NonPausable()
      await service._doInit()

      expect(await service._doPause()).toBe(false)
      expect(service.state).toBe(LifecycleState.Ready) // unchanged
    })

    it('should pause and resume a Pausable service', async () => {
      class PausableService extends BaseService {
        onPause = vi.fn()
        onResume = vi.fn()
      }

      const service = new PausableService()
      await service._doInit()

      expect(await service._doPause()).toBe(true)
      expect(service.state).toBe(LifecycleState.Paused)
      expect(service.isPaused).toBe(true)
      expect(service.onPause).toHaveBeenCalledOnce()

      expect(await service._doResume()).toBe(true)
      expect(service.state).toBe(LifecycleState.Ready)
      expect(service.isReady).toBe(true)
      expect(service.onResume).toHaveBeenCalledOnce()
    })
  })
})
