import { CacheService } from '@data/CacheService'
import { DataApiService } from '@data/DataApiService'
import { DbService } from '@data/db/DbService'
import { PreferenceService } from '@data/PreferenceService'
import { AgentJobsService } from '@main/ai/agents/AgentJobsService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { AiService } from '@main/ai/AiService'
import { ChannelManager } from '@main/ai/channels'
import { EmbeddingInferenceService } from '@main/ai/inference/EmbeddingInferenceService'
import { OcrInferenceService } from '@main/ai/inference/OcrInferenceService'
import { McpCatalogService } from '@main/ai/mcp/McpCatalogService'
import { McpPackageService } from '@main/ai/mcp/McpPackageService'
import { McpRuntimeService } from '@main/ai/mcp/McpRuntimeService'
import { ClaudeCodeTraceBridgeService, NodeTraceService, TraceStorageService } from '@main/ai/observability'
import { ClaudeCodeWarmQueryManager } from '@main/ai/runtime/claudeCode'
import { AiStreamManager } from '@main/ai/streamManager'
import { JobManager } from '@main/core/job/JobManager'
import type { ServiceConstructor } from '@main/core/lifecycle'
import { PowerService } from '@main/core/power/PowerService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { WindowManager } from '@main/core/window/WindowManager'
import { ApiGatewayService } from '@main/features/apiGateway/ApiGatewayService'
import { FileProcessingService, TesseractRuntimeService } from '@main/features/fileProcessing'
import { KnowledgeService, KnowledgeVectorStoreService } from '@main/features/knowledge'
import { IpcApiService } from '@main/ipc/IpcApiService'
import { AnalyticsService } from '@main/services/AnalyticsService'
import { AppMenuService } from '@main/services/AppMenuService'
import { AppUpdaterService } from '@main/services/AppUpdaterService'
import { BinaryManager } from '@main/services/BinaryManager'
import { CitationPreviewService } from '@main/services/CitationPreviewService'
import { CodeCliService } from '@main/services/codeCli'
import { CommandService } from '@main/services/CommandService'
import { DirectoryTreeManager, FileManager } from '@main/services/file'
import { LanTransferService } from '@main/services/lanTransfer'
import { MainNetworkDevtoolsService } from '@main/services/mainNetworkDevtools'
import { MainWindowService } from '@main/services/MainWindowService'
import { OAuthRuntimeService } from '@main/services/oauth/runtime/OAuthRuntimeService'
import { OpenClawService } from '@main/services/OpenClawService'
import { OvmsManager } from '@main/services/OvmsManager'
import { ProtocolService } from '@main/services/protocol/ProtocolService'
import { ProxyService } from '@main/services/proxy/ProxyService'
import { PythonService } from '@main/services/PythonService'
import { QuickAssistantService } from '@main/services/QuickAssistantService'
import { SelectionService } from '@main/services/selection/SelectionService'
import { ShortcutService } from '@main/services/ShortcutService'
import { StorageMonitorService } from '@main/services/StorageMonitorService'
import { SubWindowService } from '@main/services/SubWindowService'
import { ThemeService } from '@main/services/ThemeService'
import { TrayService } from '@main/services/TrayService'
import { WebSearchService } from '@main/services/webSearch'
import { WebviewService } from '@main/services/WebviewService'

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
  MainNetworkDevtoolsService,
  WindowManager,
  DbService,
  CacheService,
  DataApiService,
  IpcApiService,
  SubWindowService,
  PreferenceService,
  TesseractRuntimeService,
  AnalyticsService,
  AppMenuService,
  CodeCliService,
  CommandService,
  CitationPreviewService,
  LanTransferService,
  FileManager,
  DirectoryTreeManager,
  FileProcessingService,
  PowerService,
  SelectionService,
  ShortcutService,
  ThemeService,
  TraceStorageService,
  NodeTraceService,
  ClaudeCodeTraceBridgeService,
  OvmsManager,
  ProtocolService,
  ProxyService,
  StorageMonitorService,
  PythonService,
  TrayService,
  WebSearchService,
  WebviewService,
  OAuthRuntimeService,
  MainWindowService,
  QuickAssistantService,
  McpPackageService,
  McpRuntimeService,
  McpCatalogService,
  BinaryManager,
  OpenClawService,
  AgentSessionRuntimeService,
  AgentJobsService,
  ChannelManager,
  AiService,
  ClaudeCodeWarmQueryManager,
  AiStreamManager,
  EmbeddingInferenceService,
  OcrInferenceService,
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
