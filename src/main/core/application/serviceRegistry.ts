import { CacheService } from '@data/CacheService'
import { DataApiService } from '@data/DataApiService'
import { DbService } from '@data/db/DbService'
import { PreferenceService } from '@data/PreferenceService'
import { WebSearchService } from '@main/services/webSearch/WebSearchService'

import type { ServiceConstructor } from '../lifecycle/types'

/**
 * Centralized service registry.
 * Add services here for both runtime registration and type-safe resolution.
 *
 * Services managed by the lifecycle system should NOT export singleton instances.
 * Main process code accesses services via `application.get('ServiceName')`.
 * The service CLASS is exported for type references (e.g., @DependsOn, ServiceRegistry).
 *
 * @example
 * // Adding a new service:
 * import { NewService } from './path/NewService'
 *
 * export const services = {
 *   ...existingServices,
 *   NewService,  // ← Just add one line, types are auto-derived
 * } as const
 */

/**
 * Service registry object.
 * Key = service name for application.get('xxx')
 * Value = service class constructor
 */
export const services = {
  DbService,
  CacheService,
  DataApiService,
  PreferenceService,
  WebSearchService
} as const

/** Auto-derived service name to instance type mapping */
export type ServiceRegistry = {
  [K in keyof typeof services]: InstanceType<(typeof services)[K]>
}

/** Service list for Application.registerAll() */
export const serviceList = Object.values(services) as ServiceConstructor[]
