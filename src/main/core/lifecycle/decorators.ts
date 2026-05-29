import 'reflect-metadata'

import { type ErrorStrategy, Phase, type ServiceCondition, type ServiceConstructor } from './types'

/** Metadata keys for decorator storage */
const METADATA_KEYS = {
  INJECTABLE: 'lifecycle:injectable',
  DEPENDENCIES: 'lifecycle:dependencies',
  PRIORITY: 'lifecycle:priority',
  ERROR_STRATEGY: 'lifecycle:errorStrategy',
  SERVICE_NAME: 'lifecycle:serviceName',
  PHASE: 'lifecycle:phase',
  CONDITIONS: 'lifecycle:conditions'
} as const

/**
 * Mark a class as injectable service
 * @param name - Explicit service name. Required because bundlers mangle class names
 *               (e.g., rolldown-vite appends `$1`, making `target.name` unreliable).
 *               This name is used for `application.get(name)` and `@DependsOn([name])`,
 *               and must match the key in `serviceRegistry.ts`.
 */
export function Injectable(name: string): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.INJECTABLE, true, target)
    Reflect.defineMetadata(METADATA_KEYS.SERVICE_NAME, name, target)
  }
}

/**
 * Declare service dependencies
 * Dependencies will be injected and initialized before this service
 * @param dependencies - Array of dependency service names
 */
export function DependsOn(dependencies: string[]): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.DEPENDENCIES, dependencies, target)
  }
}

/**
 * Set initialization priority (lower = earlier)
 * @param priority - Priority number
 */
export function Priority(priority: number): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.PRIORITY, priority, target)
  }
}

/**
 * Set error handling strategy for a service
 * @param strategy - Error strategy
 */
export function ErrorHandling(strategy: ErrorStrategy): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.ERROR_STRATEGY, strategy, target)
  }
}

/**
 * Set bootstrap phase for a service
 * @param phase - Bootstrap phase (BeforeReady, Background, or WhenReady)
 */
export function ServicePhase(phase: Phase): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.PHASE, phase, target)
  }
}

/**
 * Get whether a class is marked as injectable
 * @param target - Class constructor
 */
export function isInjectable(target: ServiceConstructor): boolean {
  return Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target) === true
}

/**
 * Get service name from metadata
 * @param target - Class constructor
 */
export function getServiceName(target: ServiceConstructor): string {
  return Reflect.getMetadata(METADATA_KEYS.SERVICE_NAME, target) || target.name
}

/**
 * Get service dependencies
 * @param target - Class constructor
 */
export function getDependencies(target: ServiceConstructor): string[] {
  return Reflect.getMetadata(METADATA_KEYS.DEPENDENCIES, target) || []
}

/**
 * Get service priority
 * @param target - Class constructor
 */
export function getPriority(target: ServiceConstructor): number {
  return Reflect.getMetadata(METADATA_KEYS.PRIORITY, target) ?? 100
}

/**
 * Get service error strategy
 * @param target - Class constructor
 */
export function getErrorStrategy(target: ServiceConstructor): ErrorStrategy {
  return Reflect.getMetadata(METADATA_KEYS.ERROR_STRATEGY, target) || 'graceful'
}

/**
 * Get service bootstrap phase
 * @param target - Class constructor
 */
export function getPhase(target: ServiceConstructor): Phase {
  return Reflect.getMetadata(METADATA_KEYS.PHASE, target) || Phase.WhenReady
}

/**
 * Declare activation conditions for a service.
 * Multiple conditions in a single call use AND logic — all must match.
 * Does not support stacking — a second @Conditional call overwrites the first.
 * @param conditions - One or more ServiceCondition instances
 */
export function Conditional(...conditions: ServiceCondition[]): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.CONDITIONS, conditions, target)
  }
}

/**
 * Get activation conditions from metadata
 * @param target - Class constructor
 */
export function getConditions(target: ServiceConstructor): ServiceCondition[] | undefined {
  return Reflect.getMetadata(METADATA_KEYS.CONDITIONS, target)
}
