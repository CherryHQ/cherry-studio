import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BaseService } from '../BaseService'
import { DependsOn, ErrorHandling, ExcludePlatforms, Injectable, Priority, ServicePhase } from '../decorators'
import { ServiceContainer } from '../ServiceContainer'
import { matchesPlatformTarget, Phase } from '../types'

// ── Test service classes ──

@Injectable()
class SimpleService extends BaseService {}

@Injectable()
@Priority(10)
@ServicePhase(Phase.BeforeReady)
@ErrorHandling('fail-fast')
class PriorityService extends BaseService {}

@Injectable()
class DependencyA extends BaseService {}

@Injectable()
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

      @Injectable()
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

  describe('platform exclusion', () => {
    const originalPlatform = process.platform
    const originalArch = process.arch

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
      Object.defineProperty(process, 'arch', { value: originalArch })
    })

    // ── Test service classes for platform exclusion ──

    @Injectable()
    @ExcludePlatforms(['linux'])
    class LinuxExcludedService extends BaseService {}

    @Injectable()
    @ExcludePlatforms(['linux-arm64'])
    class LinuxArm64ExcludedService extends BaseService {}

    @Injectable()
    @DependsOn(['LinuxExcludedService'])
    class DependsOnLinuxExcluded extends BaseService {}

    @Injectable()
    @DependsOn(['DependsOnLinuxExcluded'])
    class TransitiveDependentService extends BaseService {}

    it('should register a service without @ExcludePlatforms on any platform', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const container = ServiceContainer.getInstance()
      container.register(SimpleService)
      expect(container.has('SimpleService')).toBe(true)
    })

    it('should register when current platform is not in the exclusion list', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxExcludedService)
      expect(container.has('LinuxExcludedService')).toBe(true)
      expect(container.isPlatformExcluded('LinuxExcludedService')).toBe(false)
    })

    it('should skip registration when current platform is in the exclusion list', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxExcludedService)
      expect(container.has('LinuxExcludedService')).toBe(false)
      expect(container.isPlatformExcluded('LinuxExcludedService')).toBe(true)
    })

    it('should skip registration when platform-arch target matches', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      Object.defineProperty(process, 'arch', { value: 'arm64' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxArm64ExcludedService)
      expect(container.has('LinuxArm64ExcludedService')).toBe(false)
      expect(container.isPlatformExcluded('LinuxArm64ExcludedService')).toBe(true)
    })

    it('should register when platform matches but arch does not', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      Object.defineProperty(process, 'arch', { value: 'x64' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxArm64ExcludedService)
      expect(container.has('LinuxArm64ExcludedService')).toBe(true)
      expect(container.isPlatformExcluded('LinuxArm64ExcludedService')).toBe(false)
    })

    it('should store excludePlatforms in metadata', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxExcludedService)
      const metadata = container.getMetadata('LinuxExcludedService')
      expect(metadata?.excludePlatforms).toEqual(['linux'])
    })

    it('should transitively exclude services that depend on an excluded service', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxExcludedService)
      container.register(DependsOnLinuxExcluded)
      container.excludeDependentsOfExcluded()

      expect(container.has('LinuxExcludedService')).toBe(false)
      expect(container.has('DependsOnLinuxExcluded')).toBe(false)
      expect(container.isPlatformExcluded('DependsOnLinuxExcluded')).toBe(true)
    })

    it('should handle multi-layer transitive exclusion chains', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxExcludedService)
      container.register(DependsOnLinuxExcluded)
      container.register(TransitiveDependentService)
      container.excludeDependentsOfExcluded()

      expect(container.isPlatformExcluded('LinuxExcludedService')).toBe(true)
      expect(container.isPlatformExcluded('DependsOnLinuxExcluded')).toBe(true)
      expect(container.isPlatformExcluded('TransitiveDependentService')).toBe(true)
      expect(container.getServiceNames()).not.toContain('TransitiveDependentService')
    })

    it('should not affect unrelated services during transitive exclusion', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const container = ServiceContainer.getInstance()
      container.register(LinuxExcludedService)
      container.register(DependsOnLinuxExcluded)
      container.register(SimpleService)
      container.excludeDependentsOfExcluded()

      expect(container.has('SimpleService')).toBe(true)
      expect(container.isPlatformExcluded('SimpleService')).toBe(false)
    })
  })
})

describe('matchesPlatformTarget', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
  })

  it('should match platform-only target', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect(matchesPlatformTarget(['linux'])).toBe(true)
  })

  it('should not match different platform-only target', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    expect(matchesPlatformTarget(['linux'])).toBe(false)
  })

  it('should match platform-arch target', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    expect(matchesPlatformTarget(['linux-arm64'])).toBe(true)
  })

  it('should not match when platform matches but arch differs', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(matchesPlatformTarget(['linux-arm64'])).toBe(false)
  })

  it('should match if any target in the array matches', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect(matchesPlatformTarget(['linux', 'win32'])).toBe(true)
  })

  it('should return false for empty array', () => {
    expect(matchesPlatformTarget([])).toBe(false)
  })
})
