/**
 * Bootstrap phase enumeration
 * Determines when a service should be initialized relative to app.whenReady()
 */
export enum Phase {
  /** Initialize before app.whenReady(), must complete before WhenReady phase */
  BeforeReady = 'beforeReady',
  /** Initialize independently, fire-and-forget, does not block other phases */
  Background = 'background',
  /** Initialize after app.whenReady() (default) */
  WhenReady = 'whenReady'
}

/**
 * Phase priority for comparison (lower = earlier)
 */
export const PhasePriority: Record<Phase, number> = {
  [Phase.BeforeReady]: 0,
  [Phase.Background]: 1,
  [Phase.WhenReady]: 2
}

/**
 * Lifecycle state enumeration
 * Represents the different stages a service goes through during its lifecycle
 *
 * State transitions:
 * Created → Initializing → Ready ⇄ Paused
 *                ↑           ↓
 *                │        Stopping → Stopped
 *                │                      ↓
 *                └──────────────────────┘ (restart: back to Initializing)
 *                                       ↓
 *                                   Destroyed
 */
export enum LifecycleState {
  /** Service instance has been created but not initialized */
  Created = 'created',
  /** Service is currently initializing */
  Initializing = 'initializing',
  /** Service is fully initialized and ready to use */
  Ready = 'ready',
  /** Service is in the process of pausing */
  Pausing = 'pausing',
  /** Service is paused (temporarily suspended) */
  Paused = 'paused',
  /** Service is in the process of resuming from paused state */
  Resuming = 'resuming',
  /** Service is in the process of stopping */
  Stopping = 'stopping',
  /** Service has stopped but not yet destroyed */
  Stopped = 'stopped',
  /** Service has been destroyed and cannot be used */
  Destroyed = 'destroyed'
}

/**
 * Error handling strategy for lifecycle operations
 */
export type ErrorStrategy = 'fail-fast' | 'graceful' | 'custom'

/**
 * Error thrown when a fail-fast service fails to initialize.
 * Carries the service name and original cause for structured handling by Application.
 */
export class ServiceInitError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly cause: Error
  ) {
    super(`Service '${serviceName}' failed to initialize: ${cause.message}`)
    this.name = 'ServiceInitError'
  }
}

/**
 * Context provided to conditions during evaluation.
 * Encapsulates runtime environment for testability (inject mock context in tests).
 */
export interface ConditionContext {
  /** Current Node.js platform */
  readonly platform: NodeJS.Platform
  /** Current CPU architecture */
  readonly arch: NodeJS.Architecture
  /** CPU model string from os.cpus()[0].model, empty string if unavailable */
  readonly cpuModel: string
  /** Environment variables */
  readonly env: Record<string, string | undefined>
}

/**
 * Interface for service activation conditions.
 * Evaluated synchronously at registration time, before service instantiation.
 */
export interface ServiceCondition {
  /** Human-readable description for logging when condition fails */
  readonly description: string
  /** Evaluate the condition. Return true to allow activation. */
  matches(context: ConditionContext): boolean
}

/**
 * Service metadata stored via decorators
 */
export interface ServiceMetadata {
  /** Service identifier/name */
  name: string
  /** List of dependency service names */
  dependencies: string[]
  /** Initialization priority (lower = earlier) */
  priority: number
  /** Error handling strategy */
  errorStrategy: ErrorStrategy
  /** Bootstrap phase */
  phase: Phase
  /** Activation conditions. All must match for service to register. */
  conditions?: ServiceCondition[]
}

/**
 * Service constructor type
 */
export type ServiceConstructor<T = unknown> = new (...args: unknown[]) => T

/**
 * Lifecycle event name constants
 * All events are prefixed with 'lifecycle:' for consistent namespacing
 */
export const LifecycleEvents = {
  SERVICE_CREATED: 'lifecycle:service:created',
  SERVICE_INITIALIZING: 'lifecycle:service:initializing',
  SERVICE_READY: 'lifecycle:service:ready',
  SERVICE_PAUSING: 'lifecycle:service:pausing',
  SERVICE_PAUSED: 'lifecycle:service:paused',
  SERVICE_RESUMING: 'lifecycle:service:resuming',
  SERVICE_RESUMED: 'lifecycle:service:resumed',
  SERVICE_STOPPING: 'lifecycle:service:stopping',
  SERVICE_STOPPED: 'lifecycle:service:stopped',
  SERVICE_DESTROYED: 'lifecycle:service:destroyed',
  SERVICE_ERROR: 'lifecycle:service:error',
  ALL_SERVICES_READY: 'lifecycle:all-services-ready',
  APP_ACTIVATE: 'lifecycle:app:activate'
} as const

/**
 * Lifecycle event type derived from LifecycleEvents constant object
 */
export type LifecycleEvent = (typeof LifecycleEvents)[keyof typeof LifecycleEvents]

/**
 * Lifecycle event payload
 */
export interface LifecycleEventPayload {
  /** Service name */
  name: string
  /** Current state */
  state: LifecycleState
  /** Error if any */
  error?: Error
}

/**
 * Service token for container registration
 * Can be a string identifier or a class constructor
 */
export type ServiceToken<T = unknown> = string | ServiceConstructor<T>

/**
 * Service provider configuration
 */
export interface ServiceProvider<T = unknown> {
  /** Service constructor */
  useClass: ServiceConstructor<T>
  /** Service metadata */
  metadata: ServiceMetadata
}

/**
 * Registered service entry in container
 */
export interface ServiceEntry<T = unknown> {
  /** Service token */
  token: ServiceToken<T>
  /** Service provider */
  provider: ServiceProvider<T>
  /** Singleton instance (if applicable) */
  instance?: T
}

/**
 * Dependency graph node for topological sorting
 */
export interface DependencyNode {
  /** Service name */
  name: string
  /** Dependencies (service names) */
  dependencies: string[]
  /** Priority for ordering */
  priority: number
  /** Bootstrap phase */
  phase: Phase
}

/**
 * Interface for services that support pause/resume operations.
 * Services implementing this interface can be temporarily suspended
 * (e.g., when window becomes inactive) and later resumed.
 */
export interface Pausable {
  /** Called when the service is being paused */
  onPause(): Promise<void> | void
  /** Called when the service is being resumed */
  onResume(): Promise<void> | void
}

/**
 * Type guard to check if a service implements the Pausable interface
 * @param service - Service instance to check
 * @returns True if the service implements Pausable
 */
export function isPausable(service: unknown): service is Pausable {
  return (
    typeof service === 'object' &&
    service !== null &&
    'onPause' in service &&
    'onResume' in service &&
    typeof (service as Pausable).onPause === 'function' &&
    typeof (service as Pausable).onResume === 'function'
  )
}
