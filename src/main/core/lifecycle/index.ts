export { BaseService } from './BaseService'
export {
  DependsOn,
  ErrorHandling,
  ExcludePlatforms,
  getDependencies,
  getErrorStrategy,
  getExcludePlatforms,
  getPhase,
  getPriority,
  getServiceName,
  Injectable,
  isInjectable,
  Priority,
  ServicePhase
} from './decorators'
export { CircularDependencyError, DependencyResolver, type PhaseAdjustment } from './DependencyResolver'
export { LifecycleManager } from './LifecycleManager'
export { ServiceContainer } from './ServiceContainer'
export {
  type DependencyNode,
  type ErrorStrategy,
  isPausable,
  type LifecycleEvent,
  type LifecycleEventPayload,
  LifecycleEvents,
  LifecycleState,
  matchesPlatformTarget,
  type Pausable,
  Phase,
  PhasePriority,
  type PlatformTarget,
  type ServiceConstructor,
  type ServiceEntry,
  ServiceInitError,
  type ServiceMetadata,
  type ServiceProvider,
  type ServiceToken
} from './types'
