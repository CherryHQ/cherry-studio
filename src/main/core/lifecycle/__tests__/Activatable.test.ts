import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../BaseService'
import { LifecycleManager } from '../LifecycleManager'
import { ServiceContainer } from '../ServiceContainer'
import { type Activatable, isActivatable, LifecycleEvents, LifecycleState } from '../types'

// Helper: create an Activatable service class
function createActivatableServiceClass(name: string) {
  class ActivatableService extends BaseService implements Activatable {
    public activateCalls = 0
    public deactivateCalls = 0
    async onActivate() {
      this.activateCalls++
    }
    async onDeactivate() {
      this.deactivateCalls++
    }
  }
  // Decorate with Injectable metadata
  Reflect.defineMetadata('lifecycle:injectable', true, ActivatableService)
  Reflect.defineMetadata('lifecycle:serviceName', name, ActivatableService)
  Reflect.defineMetadata('lifecycle:phase', 'whenReady', ActivatableService)
  return ActivatableService
}

// Helper: create a plain (non-Activatable) service class
function createPlainServiceClass(name: string) {
  class PlainService extends BaseService {}
  Reflect.defineMetadata('lifecycle:injectable', true, PlainService)
  Reflect.defineMetadata('lifecycle:serviceName', name, PlainService)
  Reflect.defineMetadata('lifecycle:phase', 'whenReady', PlainService)
  return PlainService
}

describe('Activatable', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    ServiceContainer.reset()
    LifecycleManager.reset()
  })

  // ========================================================================
  // isActivatable type guard
  // ========================================================================

  describe('isActivatable', () => {
    it('should return true for services implementing Activatable', () => {
      const Svc = createActivatableServiceClass('TypeGuardTrue')
      const service = new Svc()
      expect(isActivatable(service)).toBe(true)
    })

    it('should return false for non-Activatable services', () => {
      const Svc = createPlainServiceClass('TypeGuardFalse')
      const service = new Svc()
      expect(isActivatable(service)).toBe(false)
    })

    it('should return false for null/undefined/primitives', () => {
      expect(isActivatable(null)).toBe(false)
      expect(isActivatable(undefined)).toBe(false)
      expect(isActivatable(42)).toBe(false)
      expect(isActivatable('string')).toBe(false)
    })
  })

  // ========================================================================
  // BaseService: _doActivate / _doDeactivate
  // ========================================================================

  describe('_doActivate', () => {
    it('should call onActivate and set isActivated = true', async () => {
      const Svc = createActivatableServiceClass('ActivateBasic')
      const service = new Svc()
      await service._doInit()

      const result = await service._doActivate()
      expect(result).toBe(true)
      expect(service.isActivated).toBe(true)
      expect(service.activateCalls).toBe(1)
    })

    it('should be idempotent — repeated calls do not re-execute onActivate', async () => {
      const Svc = createActivatableServiceClass('ActivateIdempotent')
      const service = new Svc()
      await service._doInit()

      await service._doActivate()
      await service._doActivate()
      await service._doActivate()
      expect(service.activateCalls).toBe(1)
      expect(service.isActivated).toBe(true)
    })

    it('should return false for non-Activatable services', async () => {
      const Svc = createPlainServiceClass('ActivateNonActivatable')
      const service = new Svc()
      await service._doInit()

      const result = await service._doActivate()
      expect(result).toBe(false)
      expect(service.isActivated).toBe(false)
    })

    it('should return false for non-Ready state', async () => {
      const Svc = createActivatableServiceClass('ActivateNotReady')
      const service = new Svc()
      // State is Created, not Ready
      expect(service.state).toBe(LifecycleState.Created)

      const result = await service._doActivate()
      expect(result).toBe(false)
      expect(service.isActivated).toBe(false)
    })

    it('should keep isActivated false when onActivate throws', async () => {
      class FailActivateService extends BaseService implements Activatable {
        async onActivate() {
          throw new Error('activation failed')
        }
        async onDeactivate() {}
      }
      Reflect.defineMetadata('lifecycle:injectable', true, FailActivateService)
      Reflect.defineMetadata('lifecycle:serviceName', 'FailActivate', FailActivateService)

      const service = new FailActivateService()
      await service._doInit()

      await expect(service._doActivate()).rejects.toThrow('activation failed')
      expect(service.isActivated).toBe(false)
      expect(service.state).toBe(LifecycleState.Ready)
    })

    it('should prevent concurrent execution via _activating guard', async () => {
      let resolveActivation: () => void
      const activationPromise = new Promise<void>((resolve) => {
        resolveActivation = resolve
      })

      class SlowActivateService extends BaseService implements Activatable {
        public activateCalls = 0
        async onActivate() {
          this.activateCalls++
          await activationPromise
        }
        async onDeactivate() {}
      }
      Reflect.defineMetadata('lifecycle:injectable', true, SlowActivateService)
      Reflect.defineMetadata('lifecycle:serviceName', 'SlowActivate', SlowActivateService)

      const service = new SlowActivateService()
      await service._doInit()

      // Start first activation (will block)
      const first = service._doActivate()
      // Second call should return immediately (guarded)
      const second = await service._doActivate()
      expect(second).toBe(false) // _activated is still false, _activating is true

      // Resolve the first activation
      resolveActivation!()
      const firstResult = await first
      expect(firstResult).toBe(true)
      expect(service.activateCalls).toBe(1)
    })
  })

  describe('_doDeactivate', () => {
    it('should call onDeactivate and set isActivated = false', async () => {
      const Svc = createActivatableServiceClass('DeactivateBasic')
      const service = new Svc()
      await service._doInit()
      await service._doActivate()

      const result = await service._doDeactivate()
      expect(result).toBe(true)
      expect(service.isActivated).toBe(false)
      expect(service.deactivateCalls).toBe(1)
    })

    it('should be idempotent — repeated calls do not re-execute onDeactivate', async () => {
      const Svc = createActivatableServiceClass('DeactivateIdempotent')
      const service = new Svc()
      await service._doInit()
      await service._doActivate()

      await service._doDeactivate()
      await service._doDeactivate()
      await service._doDeactivate()
      expect(service.deactivateCalls).toBe(1)
    })

    it('should return false for non-Activatable services', async () => {
      const Svc = createPlainServiceClass('DeactivateNonActivatable')
      const service = new Svc()
      await service._doInit()

      const result = await service._doDeactivate()
      expect(result).toBe(false)
    })
  })

  // ========================================================================
  // protected activate() / deactivate() (self-activation)
  // ========================================================================

  describe('protected activate/deactivate', () => {
    it('should work via protected self-activation path', async () => {
      class SelfActivateService extends BaseService implements Activatable {
        public activateCalls = 0
        public deactivateCalls = 0
        async onActivate() {
          this.activateCalls++
        }
        async onDeactivate() {
          this.deactivateCalls++
        }
        // Expose protected methods for testing
        public async doActivate() {
          return this.activate()
        }
        public async doDeactivate() {
          return this.deactivate()
        }
      }
      Reflect.defineMetadata('lifecycle:injectable', true, SelfActivateService)
      Reflect.defineMetadata('lifecycle:serviceName', 'SelfActivate', SelfActivateService)

      const service = new SelfActivateService()
      await service._doInit()

      expect(await service.doActivate()).toBe(true)
      expect(service.isActivated).toBe(true)
      expect(service.activateCalls).toBe(1)

      expect(await service.doDeactivate()).toBe(true)
      expect(service.isActivated).toBe(false)
      expect(service.deactivateCalls).toBe(1)
    })
  })

  // ========================================================================
  // _doStop / _doDestroy integration
  // ========================================================================

  describe('_doStop integration', () => {
    it('should auto-deactivate before stopping', async () => {
      const Svc = createActivatableServiceClass('StopAutoDeactivate')
      const service = new Svc()
      await service._doInit()
      await service._doActivate()
      expect(service.isActivated).toBe(true)

      await service._doStop()
      expect(service.isActivated).toBe(false)
      expect(service.deactivateCalls).toBe(1)
      expect(service.state).toBe(LifecycleState.Stopped)
    })

    it('should not call onDeactivate for inactive Activatable services', async () => {
      const Svc = createActivatableServiceClass('StopInactive')
      const service = new Svc()
      await service._doInit()
      // Not activated

      await service._doStop()
      expect(service.deactivateCalls).toBe(0)
      expect(service.state).toBe(LifecycleState.Stopped)
    })

    it('should not block onStop when onDeactivate throws', async () => {
      const stopCalled = vi.fn()

      class FailDeactivateService extends BaseService implements Activatable {
        async onActivate() {}
        async onDeactivate() {
          throw new Error('deactivate failed')
        }
        protected override onStop() {
          stopCalled()
        }
      }
      Reflect.defineMetadata('lifecycle:injectable', true, FailDeactivateService)
      Reflect.defineMetadata('lifecycle:serviceName', 'FailDeactivate', FailDeactivateService)

      const service = new FailDeactivateService()
      await service._doInit()
      await service._doActivate()

      await service._doStop()
      expect(stopCalled).toHaveBeenCalled()
      expect(service.isActivated).toBe(false) // unconditionally reset
      expect(service.state).toBe(LifecycleState.Stopped)
    })
  })

  describe('_doDestroy integration', () => {
    it('should auto-deactivate on destroy (safety net)', async () => {
      const Svc = createActivatableServiceClass('DestroyAutoDeactivate')
      const service = new Svc()
      await service._doInit()
      await service._doActivate()

      // Destroy without stop
      await service._doDestroy()
      expect(service.isActivated).toBe(false)
      expect(service.deactivateCalls).toBe(1)
      expect(service.state).toBe(LifecycleState.Destroyed)
    })
  })

  describe('restart cycle', () => {
    it('should support activate → stop → start → activate cycle', async () => {
      const Svc = createActivatableServiceClass('RestartCycle')
      const service = new Svc()

      // First cycle
      await service._doInit()
      await service._doActivate()
      expect(service.isActivated).toBe(true)

      await service._doStop()
      expect(service.isActivated).toBe(false)

      // Restart (re-init)
      await service._doInit()
      expect(service.isActivated).toBe(false) // starts inactive

      await service._doActivate()
      expect(service.isActivated).toBe(true)
      expect(service.activateCalls).toBe(2) // second activation
    })
  })

  // ========================================================================
  // LifecycleManager: activate / deactivate
  // ========================================================================

  describe('LifecycleManager.activate', () => {
    it('should activate a registered Activatable service', async () => {
      const Svc = createActivatableServiceClass('LmActivate')
      const container = ServiceContainer.getInstance()
      container.register(Svc)

      const lm = LifecycleManager.getInstance()
      const eventSpy = vi.fn()
      lm.on(LifecycleEvents.SERVICE_ACTIVATED, eventSpy)

      // Initialize service through container
      const instance = container.get<InstanceType<typeof Svc>>('LmActivate')
      await instance._doInit()

      await lm.activate('LmActivate')
      expect(instance.isActivated).toBe(true)
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'LmActivate', state: LifecycleState.Ready })
      )
    })

    it('should warn and skip for non-Ready services', async () => {
      const Svc = createActivatableServiceClass('LmActivateNotReady')
      const container = ServiceContainer.getInstance()
      container.register(Svc)

      const instance = container.get<InstanceType<typeof Svc>>('LmActivateNotReady')
      // State is Created (not initialized)

      const lm = LifecycleManager.getInstance()
      await lm.activate('LmActivateNotReady')
      expect(instance.isActivated).toBe(false)
    })
  })

  describe('LifecycleManager.deactivate', () => {
    it('should deactivate an activated service', async () => {
      const Svc = createActivatableServiceClass('LmDeactivate')
      const container = ServiceContainer.getInstance()
      container.register(Svc)

      const lm = LifecycleManager.getInstance()
      const eventSpy = vi.fn()
      lm.on(LifecycleEvents.SERVICE_DEACTIVATED, eventSpy)

      const instance = container.get<InstanceType<typeof Svc>>('LmDeactivate')
      await instance._doInit()
      await instance._doActivate()

      await lm.deactivate('LmDeactivate')
      expect(instance.isActivated).toBe(false)
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'LmDeactivate', state: LifecycleState.Ready })
      )
    })

    it('should be no-op after stop auto-deactivates', async () => {
      const Svc = createActivatableServiceClass('LmDeactivateAfterStop')
      const container = ServiceContainer.getInstance()
      container.register(Svc)

      const instance = container.get<InstanceType<typeof Svc>>('LmDeactivateAfterStop')
      await instance._doInit()
      await instance._doActivate()

      // Stop the service — _doStop auto-deactivates
      await instance._doStop()
      expect(instance.isActivated).toBe(false)
      expect(instance.state).toBe(LifecycleState.Stopped)

      // LifecycleManager.deactivate on a stopped service should be a no-op
      const lm = LifecycleManager.getInstance()
      await lm.deactivate('LmDeactivateAfterStop')
      expect(instance.deactivateCalls).toBe(1) // only the auto-deactivate from _doStop
    })
  })
})
