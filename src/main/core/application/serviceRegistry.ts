import { CacheService } from '@data/CacheService'
import { DataApiService } from '@data/DataApiService'
import { DbService } from '@data/db/DbService'
import { PreferenceService } from '@data/PreferenceService'
import { WindowManager } from '@main/core/window/WindowManager'
import { AgentBootstrapService } from '@main/services/AgentBootstrapService'
import { AnalyticsService } from '@main/services/AnalyticsService'
import { ApiServerService } from '@main/services/ApiServerService'
import { AppMenuService } from '@main/services/AppMenuService'
import { AppUpdaterService } from '@main/services/AppUpdaterService'
import { CodeCliService } from '@main/services/CodeCliService'
import { KnowledgeOrchestrationService, KnowledgeRuntimeService } from '@main/services/knowledge'
import { KnowledgeVectorStoreService } from '@main/services/knowledge/vectorstore/KnowledgeVectorStoreService'
import { LanTransferService } from '@main/services/lanTransfer'
import { MainWindowService } from '@main/services/MainWindowService'
import { MCPService } from '@main/services/MCPService'
import { NodeTraceService } from '@main/services/NodeTraceService'
import { OcrService } from '@main/services/ocr/OcrService'
import { OpenClawService } from '@main/services/OpenClawService'
import { OvmsManager } from '@main/services/OvmsManager'
import { PowerMonitorService } from '@main/services/PowerMonitorService'
import { ProtocolService } from '@main/services/ProtocolService'
import { ProxyManager } from '@main/services/ProxyManager'
import { PythonService } from '@main/services/PythonService'
import { QuickAssistantService } from '@main/services/QuickAssistantService'
import { SearchService } from '@main/services/SearchService'
import { SelectionService } from '@main/services/SelectionService'
import { SettingsWindowService } from '@main/services/SettingsWindowService'
import { ShortcutService } from '@main/services/ShortcutService'
import { SpanCacheService } from '@main/services/SpanCacheService'
import { SubWindowService } from '@main/services/SubWindowService'
import { ThemeService } from '@main/services/ThemeService'
import { TrayService } from '@main/services/TrayService'
import { WebviewService } from '@main/services/WebviewService'

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
  WindowManager,
  DbService,
  CacheService,
  DataApiService,
  SubWindowService,
  PreferenceService,
  AnalyticsService,
  AppMenuService,
  CodeCliService,
  LanTransferService,
  PowerMonitorService,
  SelectionService,
  SettingsWindowService,
  ShortcutService,
  ThemeService,
  SpanCacheService,
  NodeTraceService,
  OcrService,
  OvmsManager,
  ProtocolService,
  ProxyManager,
  PythonService,
  TrayService,
  WebviewService,
  MainWindowService,
  QuickAssistantService,
  MCPService,
  OpenClawService,
  SearchService,
  KnowledgeOrchestrationService,
  KnowledgeVectorStoreService,
  KnowledgeRuntimeService,
  AgentBootstrapService,
  ApiServerService,
  AppUpdaterService
} as const

/** Auto-derived service name to instance type mapping */
export type ServiceRegistry = {
  [K in keyof typeof services]: InstanceType<(typeof services)[K]>
}

/** Service list for Application.registerAll() */
export const serviceList = Object.values(services) as ServiceConstructor[]
