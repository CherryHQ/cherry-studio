import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import { BaseService } from '../BaseService'
import { when } from '../conditions'
import { Conditional, DependsOn, ErrorHandling, Injectable, Priority, ServicePhase } from '../decorators'
import { LifecycleManager } from '../LifecycleManager'
import { ServiceContainer } from '../ServiceContainer'
import { defineServiceFactory, LifecycleState, Phase, type ServiceFactoryRegistration } from '../types'

@Injectable('FactoryDependency')
class FactoryDependency extends BaseService {}

@Injectable('ConfiguredService')
@DependsOn(['FactoryDependency'])
@Priority(17)
@ServicePhase(Phase.BeforeReady)
@ErrorHandling('fail-fast')
class ConfiguredService extends BaseService {
  constructor(readonly config: { limit: number } = { limit: 10 }) {
    super()
  }
}

beforeEach(() => {
  ServiceContainer.reset()
  BaseService.resetInstances()
})

afterEach(() => {
  LifecycleManager.reset()
})

describe('service factories', () => {
  it('resolves dependencies before lazy creation and retains configured class/name identity', () => {
    const container = ServiceContainer.getInstance()
    let creations = 0
    const registration = defineServiceFactory(ConfiguredService, () => {
      expect(container.getInstance(FactoryDependency)).toBe(container.get(FactoryDependency))
      creations++
      return new ConfiguredService({ limit: 3 })
    })
    container.register(FactoryDependency)
    container.register(registration)

    expect(creations).toBe(0)
    expect(container.getInstance(ConfiguredService)).toBeUndefined()
    expect(container.getMetadata(ConfiguredService)).toMatchObject({
      dependencies: ['FactoryDependency'],
      priority: 17,
      phase: Phase.BeforeReady,
      errorStrategy: 'fail-fast'
    })
    const service = container.get(ConfiguredService)
    expect(service.config.limit).toBe(3)
    expect(container.get('ConfiguredService')).toBe(service)
    expect(container.get(ConfiguredService)).toBe(service)
    expect(creations).toBe(1)
  })

  it('constructs with defaults without forwarding the dependency as configuration', () => {
    const container = ServiceContainer.getInstance()
    container.register(FactoryDependency)
    container.register(defineServiceFactory(ConfiguredService, () => new ConfiguredService()))

    expect(container.get(ConfiguredService).config).toEqual({ limit: 10 })
  })

  it('creates a fresh instance in a reset container instead of caching it in the registration', () => {
    let creations = 0
    const registration = defineServiceFactory(ConfiguredService, () => {
      creations++
      return new ConfiguredService()
    })
    const first = ServiceContainer.getInstance()
    first.register(FactoryDependency)
    first.register(registration)
    const original = first.get(ConfiguredService)
    ServiceContainer.reset()
    BaseService.resetInstances()
    const second = ServiceContainer.getInstance()
    second.register(FactoryDependency)
    second.register(registration)

    expect(second.get(ConfiguredService)).not.toBe(original)
    expect(creations).toBe(2)
  })

  it('does not execute the factory when a dependency is missing or its constructor fails', () => {
    const failure = new Error('dependency construction failed')
    const container = ServiceContainer.getInstance()
    let creations = 0
    container.register(
      defineServiceFactory(ConfiguredService, () => {
        creations++
        return new ConfiguredService()
      })
    )
    expect(() => container.get(ConfiguredService)).toThrow("Dependency 'FactoryDependency' not found")
    expect(creations).toBe(0)

    @Injectable('FactoryDependency')
    class FailingDependency extends BaseService {
      constructor() {
        super()
        throw failure
      }
    }
    container.register(FailingDependency)
    expect(() => container.get(ConfiguredService)).toThrow(failure)
    expect(creations).toBe(0)
    expect(container.getInstance(ConfiguredService)).toBeUndefined()
  })

  it('propagates factory failure without storing an instance', () => {
    const failure = new Error('factory construction failed')
    const container = ServiceContainer.getInstance()
    container.register(FactoryDependency)
    container.register(
      defineServiceFactory(ConfiguredService, () => {
        throw failure
      })
    )

    expect(() => container.get(ConfiguredService)).toThrow(failure)
    expect(container.getInstance(ConfiguredService)).toBeUndefined()
  })

  it('retains conditional lookup and transitively excludes factories before creation', () => {
    let creations = 0
    @Injectable('ExcludedService')
    @Conditional(when(() => false, 'disabled'))
    class ExcludedService extends BaseService {}
    @Injectable('DependentFactory')
    @DependsOn(['ExcludedService'])
    class DependentFactory extends BaseService {}
    @Injectable('ActiveFactory')
    @Conditional(when(() => true, 'enabled'))
    class ActiveFactory extends BaseService {}
    const container = ServiceContainer.getInstance()
    container.register(
      defineServiceFactory(ExcludedService, () => {
        creations++
        return new ExcludedService()
      })
    )
    container.register(
      defineServiceFactory(DependentFactory, () => {
        creations++
        return new DependentFactory()
      })
    )
    container.register(defineServiceFactory(ActiveFactory, () => new ActiveFactory()))
    container.excludeDependentsOfExcluded()

    expect(container.getOptional(ExcludedService)).toBeUndefined()
    expect(container.getOptional(DependentFactory)).toBeUndefined()
    expect(creations).toBe(0)
    expect(() => container.get(ActiveFactory)).toThrow('is conditional')
    const active = container.getOptional(ActiveFactory)
    expect(active).toBeInstanceOf(ActiveFactory)
    expect(container.getOptional('ActiveFactory')).toBe(active)
  })

  it('anchors factory results to the target class and requires synchronous construction', () => {
    const registration = defineServiceFactory(ConfiguredService, () => new ConfiguredService())
    expectTypeOf(registration).toEqualTypeOf<ServiceFactoryRegistration<ConfiguredService>>()
    // @ts-expect-error A different service lacks the target's configuration contract.
    defineServiceFactory(ConfiguredService, () => new FactoryDependency())
    // @ts-expect-error A promise does not synchronously construct the target service.
    defineServiceFactory(ConfiguredService, async () => new ConfiguredService())
  })

  it.each(['class', 'factory'] as const)(
    'retains initialization and reverse teardown for %s registration',
    async (kind) => {
      const events: string[] = []
      @Injectable('OrderedDependency')
      class OrderedDependency extends BaseService {
        protected override onInit() {
          events.push('dependency:init')
        }
        protected override onStop() {
          events.push('dependency:stop')
        }
        protected override onDestroy() {
          events.push('dependency:destroy')
        }
      }
      @Injectable('OrderedService')
      @DependsOn(['OrderedDependency'])
      class OrderedService extends BaseService {
        protected override onInit() {
          events.push('service:init')
        }
        protected override onStop() {
          events.push('service:stop')
        }
        protected override onDestroy() {
          events.push('service:destroy')
        }
      }
      const container = ServiceContainer.getInstance()
      container.register(OrderedDependency)
      container.register(
        kind === 'class' ? OrderedService : defineServiceFactory(OrderedService, () => new OrderedService())
      )
      expect(container.get(OrderedService).state).toBe(LifecycleState.Created)
      expect(events).toEqual([])
      const manager = LifecycleManager.getInstance()
      await manager.startPhase(Phase.WhenReady)
      expect(container.get(OrderedService).state).toBe(LifecycleState.Ready)
      await manager.stopAll()
      await manager.destroyAll()

      expect(events).toEqual([
        'dependency:init',
        'service:init',
        'service:stop',
        'dependency:stop',
        'service:destroy',
        'dependency:destroy'
      ])
    }
  )
})
