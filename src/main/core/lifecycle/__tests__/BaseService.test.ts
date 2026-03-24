import { describe, expect, it, vi } from 'vitest'

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
