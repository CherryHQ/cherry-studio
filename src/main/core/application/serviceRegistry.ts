import type { ServiceConstructor } from '../lifecycle/types'

/**
 * Centralized service registry.
 * Add services here for both runtime registration and type-safe resolution.
 *
 * @example
 * // Adding a new service:
 * import { NewService } from './path/NewService'
 *
 * export const services = {
 *   WindowManager,
 *   TrayService,
 *   NewService,  // ← Just add one line, types are auto-derived
 * } as const
 */

/**
 * Service registry object.
 * Key = service name for application.get('xxx')
 * Value = service class constructor
 */
export const services = {} as const

/** Auto-derived service name to instance type mapping */
export type ServiceRegistry = {
  [K in keyof typeof services]: InstanceType<(typeof services)[K]>
}

/** Service list for Application.registerAll() */
export const serviceList = Object.values(services) as ServiceConstructor[]
