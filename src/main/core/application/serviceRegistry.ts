import { CacheService } from '@data/CacheService'
import { DataApiService } from '@data/DataApiService'
import { DbService } from '@data/db/DbService'
import { PreferenceService } from '@data/PreferenceService'
import { AgentJobsService } from '@main/ai/agents/AgentJobsService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { AiService } from '@main/ai/AiService'
import { ChannelManager } from '@main/ai/channels/ChannelManager'
import { DxtService } from '@main/ai/mcp/DxtService'
import { McpCatalogService } from '@main/ai/mcp/McpCatalogService'
import { McpRuntimeService } from '@main/ai/mcp/McpRuntimeService'
import { ClaudeCodeTraceBridgeService } from '@main/ai/observability/adapters/claudeCode/ClaudeCodeTraceBridgeService'
import { NodeTraceService } from '@main/ai/observability/runtime/NodeTraceService'
import { TraceStorageService } from '@main/ai/observability/storage/TraceStorageService'
import { ClaudeCodeWarmQueryManager } from '@main/ai/runtime/claudeCode/ClaudeCodeWarmQueryManager'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import { JobManager } from '@main/core/job/JobManager'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { WindowManager } from '@main/core/window/WindowManager'
import { ApiGatewayService } from '@main/features/apiGateway/ApiGatewayService'
import { FileProcessingService, TesseractRuntimeService } from '@main/features/fileProcessing'
import { KnowledgeService } from '@main/features/knowledge'
import { KnowledgeVectorStoreService } from '@main/features/knowledge/vectorstore/KnowledgeVectorStoreService'
import { AnalyticsService } from '@main/services/AnalyticsService'
import { AppMenuService } from '@main/services/AppMenuService'
import { AppUpdaterService } from '@main/services/AppUpdaterService'
import { CherryInOauthService } from '@main/services/CherryInOauthService'
import { CodeCliService } from '@main/services/CodeCliService'
import { CommandService } from '@main/services/CommandService'
import { FileManager } from '@main/services/file/FileManager'
import { DirectoryTreeManager } from '@main/services/file/tree/DirectoryTreeManager'
import { LanTransferService } from '@main/services/lanTransfer'
import { MainWindowService } from '@main/services/MainWindowService'
import { OcrService } from '@main/services/ocr/OcrService'
import { OpenClawService } from '@main/services/OpenClawService'
import { OvmsManager } from '@main/services/OvmsManager'
import { PowerMonitorService } from '@main/services/PowerMonitorService'
import { ProtocolService } from '@main/services/protocol/ProtocolService'
import { ProxyManager } from '@main/services/ProxyManager'
import { PythonService } from '@main/services/PythonService'
import { QuickAssistantService } from '@main/services/QuickAssistantService'
import { SearchService } from '@main/services/SearchService'
import { SelectionService } from '@main/services/selection/SelectionService'
import { SettingsWindowService } from '@main/services/SettingsWindowService'
import { ShortcutService } from '@main/services/ShortcutService'
import { StorageMonitorService } from '@main/services/StorageMonitorService'
import { SubWindowService } from '@main/services/SubWindowService'
import { ThemeService } from '@main/services/ThemeService'
import { TrayService } from '@main/services/TrayService'
import { WebSearchService } from '@main/services/webSearch'
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
  TesseractRuntimeService,
  AnalyticsService,
  AppMenuService,
  CodeCliService,
  CommandService,
  LanTransferService,
  FileManager,
  DirectoryTreeManager,
  FileProcessingService,
  PowerMonitorService,
  SelectionService,
  SettingsWindowService,
  ShortcutService,
  ThemeService,
  TraceStorageService,
  NodeTraceService,
  ClaudeCodeTraceBridgeService,
  OcrService,
  OvmsManager,
  ProtocolService,
  ProxyManager,
  StorageMonitorService,
  PythonService,
  TrayService,
  WebSearchService,
  WebviewService,
  CherryInOauthService,
  MainWindowService,
  QuickAssistantService,
  DxtService,
  McpRuntimeService,
  McpCatalogService,
  OpenClawService,
  SearchService,
  AgentSessionRuntimeService,
  AgentJobsService,
  ChannelManager,
  AiService,
  ClaudeCodeWarmQueryManager,
  AiStreamManager,
  KnowledgeService,
  KnowledgeVectorStoreService,
  ApiGatewayService,
  AppUpdaterService,
  SchedulerService,
  JobManager
} as const

/** Auto-derived service name to instance type mapping */
export type ServiceRegistry = {
  [K in keyof typeof services]: InstanceType<(typeof services)[K]>
}

/** Service list for Application.registerAll() */
export const serviceList = Object.values(services) as ServiceConstructor[]
