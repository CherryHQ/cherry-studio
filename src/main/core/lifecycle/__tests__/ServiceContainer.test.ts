import { beforeEach, describe, expect, it } from 'vitest'

import { BaseService } from '../BaseService'
import { onPlatform, when } from '../conditions'
import { Conditional, DependsOn, ErrorHandling, Injectable, Priority, ServicePhase } from '../decorators'
import { ServiceContainer } from '../ServiceContainer'
import type { ConditionContext } from '../types'
import { Phase } from '../types'

// ── Test service classes ──

@Injectable('SimpleService')
class SimpleService extends BaseService {}

@Injectable('PriorityService')
@Priority(10)
@ServicePhase(Phase.BeforeReady)
@ErrorHandling('fail-fast')
class PriorityService extends BaseService {}

@Injectable('DependencyA')
class DependencyA extends BaseService {}

@Injectable('DependencyB')
@DependsOn(['DependencyA'])
class DependencyB extends BaseService {}

describe('ServiceContainer', () => {
  beforeEach(() => {
    ServiceContainer.reset()
    BaseService.resetInstances()
  })

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const a = ServiceContainer.getInstance()
      const b = ServiceContainer.getInstance()
      expect(a).toBe(b)
    })

    it('should create new instance after reset', () => {
      const before = ServiceContainer.getInstance()
      ServiceContainer.reset()
      const after = ServiceContainer.getInstance()
      expect(before).not.toBe(after)
    })
  })

  describe('register', () => {
    it('should register a service', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)
      expect(container.has('SimpleService')).toBe(true)
    })

    it('should skip duplicate registration', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)
      container.register(SimpleService) // Should not throw
      expect(container.getServiceNames()).toContain('SimpleService')
    })

    it('should read metadata from decorators', () => {
      const container = ServiceContainer.getInstance()
      container.register(PriorityService)

      const metadata = container.getMetadata('PriorityService')
      expect(metadata).toBeDefined()
      expect(metadata!.priority).toBe(10)
      expect(metadata!.phase).toBe(Phase.BeforeReady)
      expect(metadata!.errorStrategy).toBe('fail-fast')
    })
  })

  describe('get', () => {
    it('should create and return a service instance', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)

      const instance = container.get<SimpleService>('SimpleService')
      expect(instance).toBeInstanceOf(SimpleService)
    })

    it('should return the same singleton instance', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)

      const a = container.get<SimpleService>('SimpleService')
      const b = container.get<SimpleService>('SimpleService')
      expect(a).toBe(b)
    })

    it('should throw for unregistered service', () => {
      const container = ServiceContainer.getInstance()
      expect(() => container.get('NonExistent')).toThrow("Service 'NonExistent' not found")
    })

    it('should inject dependencies in order', () => {
      const container = ServiceContainer.getInstance()
      container.register(DependencyA)
      container.register(DependencyB)

      // DependencyB depends on DependencyA, so A must be resolved first
      const b = container.get<DependencyB>('DependencyB')
      expect(b).toBeInstanceOf(DependencyB)

      // A should also be instantiated as a side effect
      const a = container.getInstance<DependencyA>('DependencyA')
      expect(a).toBeInstanceOf(DependencyA)
    })

    it('should throw when dependency is not registered', () => {
      const container = ServiceContainer.getInstance()

      @Injectable('OrphanService')
      @DependsOn(['MissingService'])
      class OrphanService extends BaseService {}

      container.register(OrphanService)
      expect(() => container.get('OrphanService')).toThrow("Dependency 'MissingService' not found")
    })
  })

  describe('buildDependencyGraph', () => {
    it('should build graph for all services', () => {
      const container = ServiceContainer.getInstance()
      container.register(DependencyA)
      container.register(DependencyB)
      container.register(PriorityService)

      const graph = container.buildDependencyGraph()
      expect(graph).toHaveLength(3)

      const nodeB = graph.find((n) => n.name === 'DependencyB')
      expect(nodeB?.dependencies).toEqual(['DependencyA'])
    })

    it('should filter by phase', () => {
      const container = ServiceContainer.getInstance()
      container.register(DependencyA) // WhenReady (default)
      container.register(PriorityService) // BeforeReady

      const beforeReady = container.buildDependencyGraph(Phase.BeforeReady)
      expect(beforeReady).toHaveLength(1)
      expect(beforeReady[0].name).toBe('PriorityService')
    })
  })

  describe('getAll / getServiceNames', () => {
    it('should return all entries', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)
      container.register(PriorityService)

      expect(container.getAll()).toHaveLength(2)
      expect(container.getServiceNames()).toContain('SimpleService')
      expect(container.getServiceNames()).toContain('PriorityService')
    })
  })

  describe('setInstance / getInstance', () => {
    it('should set and get an instance externally', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)

      const mockInstance = {} as SimpleService
      container.setInstance('SimpleService', mockInstance)

      expect(container.getInstance('SimpleService')).toBe(mockInstance)
    })

    it('should return undefined for service without instance', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)

      expect(container.getInstance('SimpleService')).toBeUndefined()
    })
  })

  describe('updatePhase', () => {
    it('should update service phase', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)

      container.updatePhase('SimpleService', Phase.Background)
      expect(container.getMetadata('SimpleService')!.phase).toBe(Phase.Background)
    })
  })

  describe('conditional activation', () => {
    const mockContext: ConditionContext = {
      platform: 'linux',
      arch: 'x64',
      cpuModel: '12th Gen Intel(R) Core(TM) i7-12700H',
      env: {}
    }

    // ── Test service classes for conditional activation ──

    @Injectable('DarwinOnlyService')
    @Conditional(onPlatform('darwin'))
    class DarwinOnlyService extends BaseService {}

    @Injectable('LinuxOnlyService')
    @Conditional(onPlatform('linux'))
    class LinuxOnlyService extends BaseService {}

    @Injectable('MultiConditionService')
    @Conditional(
      onPlatform('win32'),
      when(() => true, 'always true')
    )
    class MultiConditionService extends BaseService {}

    @Injectable('DependsOnDarwin')
    @DependsOn(['DarwinOnlyService'])
    class DependsOnDarwin extends BaseService {}

    @Injectable('TransitiveDependentService')
    @DependsOn(['DependsOnDarwin'])
    class TransitiveDependentService extends BaseService {}

    @Injectable('ThrowingConditionService')
    @Conditional(
      when(() => {
        throw new Error('condition error')
      }, 'throws')
    )
    class ThrowingConditionService extends BaseService {}

    @Injectable('CustomConditionService')
    @Conditional(when((ctx) => ctx.cpuModel.includes('Intel'), 'Intel CPU'))
    class CustomConditionService extends BaseService {}

    it('should register a service without @Conditional on any platform', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(SimpleService)
      expect(container.has('SimpleService')).toBe(true)
    })

    it('should register when condition is met', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext) // linux
      container.register(LinuxOnlyService)
      expect(container.has('LinuxOnlyService')).toBe(true)
      expect(container.isExcluded('LinuxOnlyService')).toBe(false)
    })

    it('should skip registration when condition is not met', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext) // linux, not darwin
      container.register(DarwinOnlyService)
      expect(container.has('DarwinOnlyService')).toBe(false)
      expect(container.isExcluded('DarwinOnlyService')).toBe(true)
    })

    it('should evaluate multiple conditions with AND logic', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext) // linux, not win32
      container.register(MultiConditionService)
      // First condition (win32) fails, so service is excluded
      expect(container.has('MultiConditionService')).toBe(false)
      expect(container.isExcluded('MultiConditionService')).toBe(true)
    })

    it('should store conditions in metadata', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(LinuxOnlyService)
      const metadata = container.getMetadata('LinuxOnlyService')
      expect(metadata?.conditions).toBeDefined()
      expect(metadata!.conditions!.length).toBe(1)
    })

    it('should transitively exclude services that depend on an excluded service', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext) // linux, not darwin
      container.register(DarwinOnlyService)
      container.register(DependsOnDarwin)
      container.excludeDependentsOfExcluded()

      expect(container.has('DarwinOnlyService')).toBe(false)
      expect(container.has('DependsOnDarwin')).toBe(false)
      expect(container.isExcluded('DependsOnDarwin')).toBe(true)
    })

    it('should handle multi-layer transitive exclusion chains', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(DarwinOnlyService)
      container.register(DependsOnDarwin)
      container.register(TransitiveDependentService)
      container.excludeDependentsOfExcluded()

      expect(container.isExcluded('DarwinOnlyService')).toBe(true)
      expect(container.isExcluded('DependsOnDarwin')).toBe(true)
      expect(container.isExcluded('TransitiveDependentService')).toBe(true)
      expect(container.getServiceNames()).not.toContain('TransitiveDependentService')
    })

    it('should not affect unrelated services during transitive exclusion', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(DarwinOnlyService)
      container.register(DependsOnDarwin)
      container.register(SimpleService)
      container.excludeDependentsOfExcluded()

      expect(container.has('SimpleService')).toBe(true)
      expect(container.isExcluded('SimpleService')).toBe(false)
    })

    it('should exclude service when condition throws', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(ThrowingConditionService)
      expect(container.has('ThrowingConditionService')).toBe(false)
      expect(container.isExcluded('ThrowingConditionService')).toBe(true)
    })

    it('should support custom when() conditions with context', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext) // Intel CPU
      container.register(CustomConditionService)
      expect(container.has('CustomConditionService')).toBe(true)
    })

    it('should treat zero conditions as unconditional', () => {
      // A service with @Conditional() (no args) should still register
      @Injectable('EmptyConditionalService')
      @Conditional()
      class EmptyConditionalService extends BaseService {}

      const container = ServiceContainer.getInstance()
      container.register(EmptyConditionalService)
      expect(container.has('EmptyConditionalService')).toBe(true)
    })
  })

  describe('get/getOptional mutual exclusion', () => {
    const mockContext: ConditionContext = {
      platform: 'darwin',
      arch: 'arm64',
      cpuModel: 'Apple M2 Max',
      env: {}
    }

    @Injectable('ConditionalActiveService')
    @Conditional(onPlatform('darwin'))
    class ConditionalActiveService extends BaseService {}

    @Injectable('ConditionalExcludedService')
    @Conditional(onPlatform('win32'))
    class ConditionalExcludedService extends BaseService {}

    it('should throw when get() is called on an active conditional service', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext) // darwin
      container.register(ConditionalActiveService)

      expect(() => container.get('ConditionalActiveService')).toThrow(
        "Service 'ConditionalActiveService' is conditional — use getOptional('ConditionalActiveService')."
      )
    })

    it('should throw when get() is called on an excluded conditional service', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext) // darwin, not win32
      container.register(ConditionalExcludedService)

      expect(() => container.get('ConditionalExcludedService')).toThrow(
        "Service 'ConditionalExcludedService' was conditionally excluded — use getOptional('ConditionalExcludedService')."
      )
    })

    it('should return instance when getOptional() is called on an active conditional service', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(ConditionalActiveService)

      const instance = container.getOptional('ConditionalActiveService')
      expect(instance).toBeInstanceOf(ConditionalActiveService)
    })

    it('should return undefined when getOptional() is called on an excluded conditional service', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(ConditionalExcludedService)

      const instance = container.getOptional('ConditionalExcludedService')
      expect(instance).toBeUndefined()
    })

    it('should throw when getOptional() is called on a non-conditional service', () => {
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)

      expect(() => container.getOptional('SimpleService')).toThrow(
        "Service 'SimpleService' is not conditional — use get('SimpleService')."
      )
    })

    it('should return same singleton from getOptional()', () => {
      const container = ServiceContainer.getInstance()
      container.setConditionContext(mockContext)
      container.register(ConditionalActiveService)

      const a = container.getOptional('ConditionalActiveService')
      const b = container.getOptional('ConditionalActiveService')
      expect(a).toBe(b)
    })
  })
})
