import { afterEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../BaseService'
import { when } from '../conditions'
import { Conditional, DependsOn, ErrorHandling, Injectable } from '../decorators'
import { LifecycleManager } from '../LifecycleManager'
import { ServiceContainer } from '../ServiceContainer'
import { LifecycleEvents, LifecycleState, type Pausable, Phase, ServiceInitError } from '../types'

afterEach(() => {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
})

/** Initialize all default-phase (WhenReady) services via startPhase */
async function initializeServices(manager: LifecycleManager): Promise<void> {
  await manager.startPhase(Phase.WhenReady)
}

describe('LifecycleManager', () => {
  // ── startPhase ──

  describe('startPhase', () => {
    it('should initialize a single service and emit INITIALIZING + READY events', async () => {
      @Injectable('SimpleService')
      class SimpleService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(SimpleService)

      const initializingListener = vi.fn()
      const readyListener = vi.fn()
      manager.on(LifecycleEvents.SERVICE_INITIALIZING, initializingListener)
      manager.on(LifecycleEvents.SERVICE_READY, readyListener)

      await initializeServices(manager)

      expect(initializingListener).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'SimpleService', state: LifecycleState.Initializing })
      )
      expect(readyListener).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'SimpleService', state: LifecycleState.Ready })
      )
    })

    it('should initialize services in dependency order', async () => {
      const order: string[] = []

      @Injectable('DatabaseService')
      class DatabaseService extends BaseService {
        protected override onInit() {
          order.push('Database')
        }
      }

      @Injectable('UserService')
      @DependsOn(['DatabaseService'])
      class UserService extends BaseService {
        protected override onInit() {
          order.push('User')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(DatabaseService)
      container.register(UserService)

      await initializeServices(manager)

      expect(order).toEqual(['Database', 'User'])
    })

    it('should track initialization order', async () => {
      @Injectable('ServiceA')
      class ServiceA extends BaseService {}

      @Injectable('ServiceB')
      @DependsOn(['ServiceA'])
      class ServiceB extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ServiceA)
      container.register(ServiceB)

      await initializeServices(manager)

      const order = manager.getInitializationOrder()
      expect(order.indexOf('ServiceA')).toBeLessThan(order.indexOf('ServiceB'))
    })

    it('should set initialized flag after WhenReady phase completes', async () => {
      @Injectable('TestService')
      class TestService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(TestService)

      expect(manager.isInitialized()).toBe(false)
      await initializeServices(manager)
      expect(manager.isInitialized()).toBe(true)
    })

    it('should handle empty phase gracefully', async () => {
      const manager = LifecycleManager.getInstance()

      // No services registered, should not throw
      await expect(initializeServices(manager)).resolves.toBeUndefined()
    })

    it('should initialize a conditional service whose condition passes', async () => {
      const order: string[] = []

      @Injectable('ConditionalService')
      @Conditional(when(() => true, 'always active'))
      class ConditionalService extends BaseService {
        protected override onInit() {
          order.push('Conditional')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ConditionalService)

      await initializeServices(manager)

      expect(order).toEqual(['Conditional'])

      const instance = container.getOptional('ConditionalService')
      expect(instance).toBeDefined()
    })
  })

  // ── Error handling strategies ──

  describe('error handling', () => {
    it('should throw ServiceInitError for fail-fast strategy', async () => {
      @Injectable('CriticalService')
      @ErrorHandling('fail-fast')
      class CriticalService extends BaseService {
        protected override onInit() {
          throw new Error('Database connection failed')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(CriticalService)

      await expect(initializeServices(manager)).rejects.toThrow(ServiceInitError)
    })

    it('should continue for graceful strategy', async () => {
      const order: string[] = []

      @Injectable('OptionalService')
      @ErrorHandling('graceful')
      class OptionalService extends BaseService {
        protected override onInit() {
          throw new Error('Optional service failed')
        }
      }

      @Injectable('RequiredService')
      class RequiredService extends BaseService {
        protected override onInit() {
          order.push('Required')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(OptionalService)
      container.register(RequiredService)

      // Should not throw despite OptionalService error
      await expect(initializeServices(manager)).resolves.toBeUndefined()
      expect(order).toContain('Required')
    })

    it('should emit SERVICE_ERROR for failed service', async () => {
      const initError = new Error('init failed')

      @Injectable('BrokenService')
      @ErrorHandling('graceful')
      class BrokenService extends BaseService {
        protected override onInit() {
          throw initError
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(BrokenService)

      const errorListener = vi.fn()
      manager.on(LifecycleEvents.SERVICE_ERROR, errorListener)

      await initializeServices(manager)

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'BrokenService',
          error: initError
        })
      )
    })
  })

  // ── stopAll ──

  describe('stopAll', () => {
    it('should stop all services in reverse initialization order', async () => {
      const stopOrder: string[] = []

      @Injectable('FirstService')
      class FirstService extends BaseService {
        protected override onStop() {
          stopOrder.push('First')
        }
      }

      @Injectable('SecondService')
      @DependsOn(['FirstService'])
      class SecondService extends BaseService {
        protected override onStop() {
          stopOrder.push('Second')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(FirstService)
      container.register(SecondService)

      await initializeServices(manager)
      await manager.stopAll()

      // SecondService should stop before FirstService (reverse order)
      expect(stopOrder).toEqual(['Second', 'First'])
    })

    it('should emit STOPPING and STOPPED events', async () => {
      @Injectable('StoppableService')
      class StoppableService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(StoppableService)

      await initializeServices(manager)

      const stoppingListener = vi.fn()
      const stoppedListener = vi.fn()
      manager.on(LifecycleEvents.SERVICE_STOPPING, stoppingListener)
      manager.on(LifecycleEvents.SERVICE_STOPPED, stoppedListener)

      await manager.stopAll()

      expect(stoppingListener).toHaveBeenCalledOnce()
      expect(stoppedListener).toHaveBeenCalledOnce()
    })

    it('should no-op if not initialized', async () => {
      const manager = LifecycleManager.getInstance()
      // Should not throw
      await expect(manager.stopAll()).resolves.toBeUndefined()
    })
  })

  // ── destroyAll ──

  describe('destroyAll', () => {
    it('should destroy all services in reverse order', async () => {
      const destroyOrder: string[] = []

      @Injectable('AlphaService')
      class AlphaService extends BaseService {
        protected override onDestroy() {
          destroyOrder.push('Alpha')
        }
      }

      @Injectable('BetaService')
      @DependsOn(['AlphaService'])
      class BetaService extends BaseService {
        protected override onDestroy() {
          destroyOrder.push('Beta')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(AlphaService)
      container.register(BetaService)

      await initializeServices(manager)
      await manager.destroyAll()

      expect(destroyOrder).toEqual(['Beta', 'Alpha'])
    })

    it('should emit SERVICE_DESTROYED events', async () => {
      @Injectable('DestroyableService')
      class DestroyableService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(DestroyableService)

      await initializeServices(manager)

      const destroyedListener = vi.fn()
      manager.on(LifecycleEvents.SERVICE_DESTROYED, destroyedListener)

      await manager.destroyAll()

      expect(destroyedListener).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'DestroyableService', state: LifecycleState.Destroyed })
      )
    })

    it('should reset initialized flag and clear cascade tracking', async () => {
      @Injectable('SomeService')
      class SomeService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(SomeService)

      await initializeServices(manager)
      expect(manager.isInitialized()).toBe(true)

      await manager.destroyAll()
      expect(manager.isInitialized()).toBe(false)
      expect(manager.getInitializationOrder()).toEqual([])
    })
  })

  // ── pause / resume ──

  describe('pause / resume', () => {
    it('should pause a Pausable service', async () => {
      @Injectable('PausableService')
      class PausableService extends BaseService implements Pausable {
        public pauseCalled = false
        onPause() {
          this.pauseCalled = true
        }
        onResume() {}
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(PausableService)

      await initializeServices(manager)

      await manager.pause('PausableService')

      const instance = container.getInstance('PausableService') as PausableService
      expect(instance.isPaused).toBe(true)
      expect(instance.pauseCalled).toBe(true)
    })

    it('should emit PAUSING and PAUSED events', async () => {
      @Injectable('EventPausable')
      class EventPausable extends BaseService implements Pausable {
        onPause() {}
        onResume() {}
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(EventPausable)

      await initializeServices(manager)

      const pausingListener = vi.fn()
      const pausedListener = vi.fn()
      manager.on(LifecycleEvents.SERVICE_PAUSING, pausingListener)
      manager.on(LifecycleEvents.SERVICE_PAUSED, pausedListener)

      await manager.pause('EventPausable')

      expect(pausingListener).toHaveBeenCalledOnce()
      expect(pausedListener).toHaveBeenCalledOnce()
    })

    it('should cascade pause to dependents', async () => {
      const pauseOrder: string[] = []

      @Injectable('CoreService')
      class CoreService extends BaseService implements Pausable {
        onPause() {
          pauseOrder.push('Core')
        }
        onResume() {}
      }

      @Injectable('DependentService')
      @DependsOn(['CoreService'])
      class DependentService extends BaseService implements Pausable {
        onPause() {
          pauseOrder.push('Dependent')
        }
        onResume() {}
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(CoreService)
      container.register(DependentService)

      await initializeServices(manager)

      // Pausing CoreService should cascade to DependentService
      await manager.pause('CoreService')

      // Dependent should be paused before Core (dependents first)
      expect(pauseOrder).toEqual(['Dependent', 'Core'])

      const dependent = container.getInstance('DependentService') as BaseService
      expect(dependent.isPaused).toBe(true)
    })

    it('should abort pause if any dependent is not Pausable', async () => {
      @Injectable('PausableCore')
      class PausableCore extends BaseService implements Pausable {
        onPause() {}
        onResume() {}
      }

      @Injectable('NonPausableDependent')
      @DependsOn(['PausableCore'])
      class NonPausableDependent extends BaseService {
        // Does NOT implement Pausable
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(PausableCore)
      container.register(NonPausableDependent)

      await initializeServices(manager)

      // Should not throw, but should not pause either
      await manager.pause('PausableCore')

      const core = container.getInstance('PausableCore') as BaseService
      expect(core.isReady).toBe(true) // Still Ready, not Paused
    })

    it('should not pause a service that is not in Ready state', async () => {
      @Injectable('StoppedPausable')
      class StoppedPausable extends BaseService implements Pausable {
        onPause() {}
        onResume() {}
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(StoppedPausable)

      await initializeServices(manager)
      await manager.stop('StoppedPausable')

      const instance = container.getInstance('StoppedPausable') as BaseService
      expect(instance.isStopped).toBe(true)

      // pause from Stopped state should be a no-op
      await manager.pause('StoppedPausable')
      expect(instance.isStopped).toBe(true) // Still stopped, not paused
    })

    it('should resume a paused service', async () => {
      @Injectable('ResumableService')
      class ResumableService extends BaseService implements Pausable {
        public resumeCalled = false
        onPause() {}
        onResume() {
          this.resumeCalled = true
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ResumableService)

      await initializeServices(manager)
      await manager.pause('ResumableService')

      const instance = container.getInstance('ResumableService') as ResumableService
      expect(instance.isPaused).toBe(true)

      await manager.resume('ResumableService')
      expect(instance.isReady).toBe(true)
      expect(instance.resumeCalled).toBe(true)
    })

    it('should emit RESUMING and RESUMED events', async () => {
      @Injectable('EventResumable')
      class EventResumable extends BaseService implements Pausable {
        onPause() {}
        onResume() {}
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(EventResumable)

      await initializeServices(manager)
      await manager.pause('EventResumable')

      const resumingListener = vi.fn()
      const resumedListener = vi.fn()
      manager.on(LifecycleEvents.SERVICE_RESUMING, resumingListener)
      manager.on(LifecycleEvents.SERVICE_RESUMED, resumedListener)

      await manager.resume('EventResumable')

      expect(resumingListener).toHaveBeenCalledOnce()
      expect(resumedListener).toHaveBeenCalledOnce()
    })

    it('should cascade resume to dependents that were cascade-paused', async () => {
      const resumeOrder: string[] = []

      @Injectable('Base')
      class Base extends BaseService implements Pausable {
        onPause() {}
        onResume() {
          resumeOrder.push('Base')
        }
      }

      @Injectable('Child')
      @DependsOn(['Base'])
      class Child extends BaseService implements Pausable {
        onPause() {}
        onResume() {
          resumeOrder.push('Child')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(Base)
      container.register(Child)

      await initializeServices(manager)
      await manager.pause('Base')

      // Both should be paused
      expect((container.getInstance('Base') as BaseService).isPaused).toBe(true)
      expect((container.getInstance('Child') as BaseService).isPaused).toBe(true)

      await manager.resume('Base')

      // Both should be resumed (Base first, then Child)
      expect(resumeOrder).toEqual(['Base', 'Child'])
      expect((container.getInstance('Base') as BaseService).isReady).toBe(true)
      expect((container.getInstance('Child') as BaseService).isReady).toBe(true)
    })

    it('should not resume a service that is not in Paused state', async () => {
      @Injectable('ReadyService')
      class ReadyService extends BaseService implements Pausable {
        onPause() {}
        onResume() {}
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ReadyService)

      await initializeServices(manager)

      // Service is Ready, not Paused. Resume should be a no-op
      await manager.resume('ReadyService')

      const instance = container.getInstance('ReadyService') as BaseService
      expect(instance.isReady).toBe(true)
    })

    it('should warn and no-op for non-existent service', async () => {
      const manager = LifecycleManager.getInstance()
      // Should not throw
      await expect(manager.pause('NonExistent')).resolves.toBeUndefined()
      await expect(manager.resume('NonExistent')).resolves.toBeUndefined()
    })
  })

  // ── stop / start / restart ──

  describe('stop / start / restart', () => {
    it('should stop a service from Ready state', async () => {
      @Injectable('StoppableService')
      class StoppableService extends BaseService {
        public stopCalled = false
        protected override onStop() {
          this.stopCalled = true
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(StoppableService)

      await initializeServices(manager)

      await manager.stop('StoppableService')

      const instance = container.getInstance('StoppableService') as StoppableService
      expect(instance.isStopped).toBe(true)
      expect(instance.stopCalled).toBe(true)
    })

    it('should cascade stop to dependents', async () => {
      const stopOrder: string[] = []

      @Injectable('ParentService')
      class ParentService extends BaseService {
        protected override onStop() {
          stopOrder.push('Parent')
        }
      }

      @Injectable('ChildService')
      @DependsOn(['ParentService'])
      class ChildService extends BaseService {
        protected override onStop() {
          stopOrder.push('Child')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ParentService)
      container.register(ChildService)

      await initializeServices(manager)

      await manager.stop('ParentService')

      // Child stopped before Parent (dependents first)
      expect(stopOrder).toEqual(['Child', 'Parent'])

      const child = container.getInstance('ChildService') as BaseService
      expect(child.isStopped).toBe(true)
    })

    it('should not stop a service that is already stopped', async () => {
      const stopCount = { value: 0 }

      @Injectable('AlreadyStoppedService')
      class AlreadyStoppedService extends BaseService {
        protected override onStop() {
          stopCount.value++
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(AlreadyStoppedService)

      await initializeServices(manager)
      await manager.stop('AlreadyStoppedService')
      expect(stopCount.value).toBe(1)

      // Second stop should be a no-op
      await manager.stop('AlreadyStoppedService')
      expect(stopCount.value).toBe(1) // Not called again
    })

    it('should start a stopped service by re-initializing', async () => {
      let initCount = 0

      @Injectable('RestartableService')
      class RestartableService extends BaseService {
        protected override onInit() {
          initCount++
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(RestartableService)

      await initializeServices(manager)
      expect(initCount).toBe(1)

      await manager.stop('RestartableService')
      expect((container.getInstance('RestartableService') as BaseService).isStopped).toBe(true)

      await manager.start('RestartableService')
      expect(initCount).toBe(2)
      expect((container.getInstance('RestartableService') as BaseService).isReady).toBe(true)
    })

    it('should cascade start to dependents that were cascade-stopped', async () => {
      const initOrder: string[] = []

      @Injectable('RootService')
      class RootService extends BaseService {
        protected override onInit() {
          initOrder.push('Root')
        }
      }

      @Injectable('LeafService')
      @DependsOn(['RootService'])
      class LeafService extends BaseService {
        protected override onInit() {
          initOrder.push('Leaf')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(RootService)
      container.register(LeafService)

      await initializeServices(manager)
      initOrder.length = 0 // Reset

      // Stop Root → cascades to Leaf
      await manager.stop('RootService')
      expect((container.getInstance('LeafService') as BaseService).isStopped).toBe(true)

      // Start Root → should also restart Leaf
      await manager.start('RootService')

      expect((container.getInstance('RootService') as BaseService).isReady).toBe(true)
      expect((container.getInstance('LeafService') as BaseService).isReady).toBe(true)
    })

    it('should not start a service that is not in Stopped state', async () => {
      @Injectable('ReadyStartService')
      class ReadyStartService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ReadyStartService)

      await initializeServices(manager)

      // Service is Ready, not Stopped. Start should be a no-op
      await manager.start('ReadyStartService')

      const instance = container.getInstance('ReadyStartService') as BaseService
      expect(instance.isReady).toBe(true)
    })

    it('should restart a service (stop + start)', async () => {
      let initCount = 0

      @Injectable('RestartableService2')
      class RestartableService2 extends BaseService {
        protected override onInit() {
          initCount++
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(RestartableService2)

      await initializeServices(manager)
      expect(initCount).toBe(1)

      await manager.restart('RestartableService2')

      expect(initCount).toBe(2)
      expect((container.getInstance('RestartableService2') as BaseService).isReady).toBe(true)
    })

    it('should just start if already stopped', async () => {
      let initCount = 0

      @Injectable('AlreadyStopped')
      class AlreadyStopped extends BaseService {
        protected override onInit() {
          initCount++
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(AlreadyStopped)

      await initializeServices(manager)
      await manager.stop('AlreadyStopped')

      initCount = 0
      await manager.restart('AlreadyStopped')

      // Should only init once (start, not stop+start)
      expect(initCount).toBe(1)
      expect((container.getInstance('AlreadyStopped') as BaseService).isReady).toBe(true)
    })

    it('should not restart a service that is destroyed', async () => {
      @Injectable('DestroyedRestartService')
      class DestroyedRestartService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(DestroyedRestartService)

      await initializeServices(manager)
      await manager.destroyAll()

      const instance = container.getInstance('DestroyedRestartService') as BaseService
      expect(instance.isDestroyed).toBe(true)

      // Restart from Destroyed state should be a no-op
      await manager.restart('DestroyedRestartService')
      expect(instance.isDestroyed).toBe(true)
    })

    it('should warn and no-op for non-existent service', async () => {
      const manager = LifecycleManager.getInstance()
      await expect(manager.stop('NonExistent')).resolves.toBeUndefined()
      await expect(manager.start('NonExistent')).resolves.toBeUndefined()
      await expect(manager.restart('NonExistent')).resolves.toBeUndefined()
    })
  })

  // ── allReady ──

  describe('allReady', () => {
    it('should call _doAllReady on all initialized services', async () => {
      const calls: string[] = []

      @Injectable('ServiceA')
      class ServiceA extends BaseService {
        protected override onAllReady() {
          calls.push('A')
        }
      }

      @Injectable('ServiceB')
      class ServiceB extends BaseService {
        protected override onAllReady() {
          calls.push('B')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ServiceA)
      container.register(ServiceB)

      await initializeServices(manager)
      await manager.allReady()

      expect(calls).toContain('A')
      expect(calls).toContain('B')
      expect(calls).toHaveLength(2)
    })

    it('should emit ALL_SERVICES_READY event after all hooks complete', async () => {
      @Injectable('SimpleService')
      class SimpleService extends BaseService {}

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(SimpleService)

      await initializeServices(manager)

      const listener = vi.fn()
      manager.on(LifecycleEvents.ALL_SERVICES_READY, listener)

      await manager.allReady()
      expect(listener).toHaveBeenCalledOnce()
    })

    it('should handle individual hook errors gracefully without throwing', async () => {
      const healthyCalls: string[] = []

      @Injectable('FailingService')
      class FailingService extends BaseService {
        protected override onAllReady() {
          throw new Error('onAllReady failed')
        }
      }

      @Injectable('HealthyService')
      class HealthyService extends BaseService {
        protected override onAllReady() {
          healthyCalls.push('healthy')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(FailingService)
      container.register(HealthyService)

      await initializeServices(manager)

      // Should not throw
      await expect(manager.allReady()).resolves.toBeUndefined()

      // Healthy service hook should still have been called
      expect(healthyCalls).toEqual(['healthy'])
    })

    it('should emit SERVICE_ERROR for services whose onAllReady fails', async () => {
      const error = new Error('hook failed')

      @Injectable('ErrorService')
      class ErrorService extends BaseService {
        protected override onAllReady() {
          throw error
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(ErrorService)

      await initializeServices(manager)

      const errorListener = vi.fn()
      manager.on(LifecycleEvents.SERVICE_ERROR, errorListener)

      await manager.allReady()

      expect(errorListener).toHaveBeenCalledOnce()
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ErrorService',
          state: LifecycleState.Ready,
          error
        })
      )
    })

    it('should emit ALL_SERVICES_READY even when some hooks fail', async () => {
      @Injectable('FailService')
      class FailService extends BaseService {
        protected override onAllReady() {
          throw new Error('fail')
        }
      }

      const manager = LifecycleManager.getInstance()
      const container = manager['container']
      container.register(FailService)

      await initializeServices(manager)

      const listener = vi.fn()
      manager.on(LifecycleEvents.ALL_SERVICES_READY, listener)

      await manager.allReady()
      expect(listener).toHaveBeenCalledOnce()
    })

    it('should work with no registered services', async () => {
      const manager = LifecycleManager.getInstance()

      const listener = vi.fn()
      manager.on(LifecycleEvents.ALL_SERVICES_READY, listener)

      await manager.allReady()
      expect(listener).toHaveBeenCalledOnce()
    })
  })
})
