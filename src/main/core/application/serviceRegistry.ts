import { CacheService } from '@data/CacheService'
import { DataApiService } from '@data/DataApiService'
import { DbService } from '@data/db/DbService'
import { PreferenceService } from '@data/PreferenceService'
import { AnalyticsService } from '@main/services/AnalyticsService'
import { ApiServerService } from '@main/services/ApiServerService'
import { AppMenuService } from '@main/services/AppMenuService'
import { CodeCliService } from '@main/services/CodeCliService'
import { LanTransferClientService } from '@main/services/lanTransfer'
import { LocalTransferService } from '@main/services/LocalTransferService'
import { MCPService } from '@main/services/MCPService'
import { NodeTraceService } from '@main/services/NodeTraceService'
import { OpenClawService } from '@main/services/OpenClawService'
import { OvmsManager } from '@main/services/OvmsManager'
import { PowerMonitorService } from '@main/services/PowerMonitorService'
import { SelectionService } from '@main/services/SelectionService'
import { ShortcutService } from '@main/services/ShortcutService'
import { SpanCacheService } from '@main/services/SpanCacheService'
import { ThemeService } from '@main/services/ThemeService'
import { TrayService } from '@main/services/TrayService'
import { WindowService } from '@main/services/WindowService'

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
  AnalyticsService,
  AppMenuService,
  CodeCliService,
  LanTransferClientService,
  LocalTransferService,
  PowerMonitorService,
  SelectionService,
  ShortcutService,
  ThemeService,
  SpanCacheService,
  NodeTraceService,
  OvmsManager,
  TrayService,
  WindowService,
  MCPService,
  OpenClawService,
  ApiServerService
} as const

/** Auto-derived service name to instance type mapping */
export type ServiceRegistry = {
  [K in keyof typeof services]: InstanceType<(typeof services)[K]>
}

/** Service list for Application.registerAll() */
export const serviceList = Object.values(services) as ServiceConstructor[]
