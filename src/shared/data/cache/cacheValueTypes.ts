import type { AbsoluteFilePath, FileType } from '@shared/types/file'
import type { McpTool } from '@shared/types/mcp'
import type { UpdateInfo } from 'builder-util-runtime'

import type { AgentSessionApiRetryState } from '../../ai/agentSessionApiRetry'
import type { AgentSessionBackgroundTasks, AgentSessionTaskEvents } from '../../ai/agentSessionBackgroundTasks'
import type { AgentSessionCompactionState } from '../../ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '../../ai/agentSessionContextUsage'
import type { AgentSessionFlowParts } from '../../ai/agentSessionFlowParts'
import type { AgentSessionSlashCommand } from '../../ai/agentSessionSlashCommands'
import type { ComposerQueuedMessagePayload } from '../../ai/transport'
import type { McpServer } from '../types/mcpServer'
import type { MiniApp } from '../types/miniApp'
import type { UniqueModelId } from '../types/model'
import type { ComposerMessageTokenKind } from '../types/uiParts'
import type { WebSearchStatus } from '../types/webSearch'

export type CacheAppUpdateState = {
  info: UpdateInfo | null
  checking: boolean
  downloading: boolean
  downloaded: boolean
  downloadProgress: number
  available: boolean
  ignore: boolean
  //   /** Whether the update check was manually triggered by user clicking the button */
  manualCheck: boolean
}

export type CacheActiveSearches = Record<string, WebSearchStatus>

// For cache schema, we use any for complex types to avoid circular dependencies
// The actual type checking will be done at runtime by the cache system
export type CacheMiniAppType = MiniApp
export type CacheMcpTool = McpTool

export type McpRuntimeStatus = {
  state: 'disabled' | 'connecting' | 'connected' | 'error'
  lastCheckedAt: number
  lastError?: string
}

/**
 * MCP registry "available servers" fetched per marketplace provider, keyed by
 * provider key. Re-fetchable network data, so it lives in persist cache rather
 * than Preference/DataApi.
 */
export type McpAvailableServers = Record<string, McpServer[]>

/**
 * Tab type for browser-like tabs
 *
 * - 'route': Internal app routes rendered via MemoryRouter
 * - 'webview': External web content rendered via Electron webview
 */
export type TabType = 'route' | 'webview'

/**
 * Tab saved state for hibernation recovery
 */
export interface TabSavedState {
  scrollPosition?: number
  // 其他必要草稿字段可在此扩展
}

export interface Tab {
  id: string
  type: TabType
  url: string
  title: string
  icon?: string
  metadata?: Record<string, unknown>
  // LRU 字段
  lastAccessTime?: number // open/switch 时更新
  isDormant?: boolean // 是否已休眠
  isPinned?: boolean // 是否置顶（soft cap 下豁免 LRU；超过 hard cap 时可能休眠）
  savedState?: TabSavedState // 休眠前保存的状态
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string
}

export type GlobalSearchRecentEntry =
  | {
      kind: 'route'
      url: string
      title: string
      icon?: string
      lastAccessTime: number
    }
  | {
      kind: 'topic'
      topicId: string
      title: string
      lastAccessTime: number
    }
  | {
      kind: 'session'
      sessionId: string
      title: string
      lastAccessTime: number
    }

export type TranslatingState =
  | {
      isTranslating: true
      abortKey: string
    }
  | {
      isTranslating: false
      abortKey: null
    }

export type OpenClawGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

/**
 * Saved scroll position for a chat topic / agent-session message list.
 *
 * Stored per topic id in the Memory cache so switching topics or sessions
 * restores the previous reading position instead of jumping to the first
 * message. A `null` cache value (the schema default) means "follow the
 * latest message" — the user was at the bottom or never scrolled, so the
 * list restores to the newest message.
 */
export interface ChatScrollAnchor {
  /** Stable group key of the top-most visible message group at save time. */
  key: string
  /** Pixels scrolled past the top of that group. */
  offset: number
}

export interface CacheComposerSerializedToken {
  id: string
  kind: ComposerMessageTokenKind | 'promptVariable'
  label: string
  icon?: string
  description?: string
  promptText?: string
  payload?: unknown
  index: number
  textOffset: number
}

export interface CacheComposerAttachment {
  fileTokenSourceId: string
  path?: AbsoluteFilePath
  name: string
  origin_name: string
  ext: string
  size: number
  type: FileType
  composerFileKind?: 'pasted-text'
}

export interface CacheComposerDraftBase {
  text: string
  tokens: CacheComposerSerializedToken[]
  files: CacheComposerAttachment[]
  knowledgeBaseIds: string[]
}

export interface CacheChatComposerDraft extends CacheComposerDraftBase {
  /** Explicit per-topic model selection; runtime model records are resolved when restoring. */
  mentionedModelIds: UniqueModelId[]
  /** Selection behavior cannot be inferred when zero or one models remain selected. */
  modelMultiSelectMode: boolean
}

export interface CacheAgentComposerDraft extends CacheComposerDraftBase {
  workspaceKey: string
  agentId: string
  shouldValidateSkills?: boolean
}

export type ExternalOpenTargetPreferences = Record<string, string>

export type CachePaintingGenerationState = {
  status: 'running' | 'failed' | 'canceled'
  taskId: string | null
  error: string | null
  progress: number | null
}

export type CacheAgentSessionContextUsage = AgentSessionContextUsage | null
export type CacheAgentSessionCompactionState = AgentSessionCompactionState | null
export type CacheAgentSessionApiRetryState = AgentSessionApiRetryState | null
export type CacheAgentSessionSlashCommands = AgentSessionSlashCommand[] | null
export type CacheAgentSessionBackgroundTasks = AgentSessionBackgroundTasks
export type CacheAgentSessionTaskEvents = AgentSessionTaskEvents
export type CacheAgentSessionFlowParts = AgentSessionFlowParts

/**
 * Persisted window geometry for the WindowManager "remember bounds" capability.
 *
 * Stored in the main-process persist cache under `window.bounds`, keyed by
 * WindowType. Captured from `getNormalBounds()` (the pre-maximize rect) plus the
 * maximized flag, so a maximized window restores to maximized while un-maximizing
 * returns to the saved normal size.
 */
export type WindowBoundsState = {
  x: number
  y: number
  width: number
  height: number
  /** Whether the window was maximized at capture time. Restored by the consumer
   *  (e.g. MainWindowService) on its own show schedule, not by WindowManager. */
  isMaximized: boolean
  /** Bounds of the display the window was last on — used at restore to put the
   *  window back onto the same display (clamping into it if the saved rect no
   *  longer fits), instead of resetting to the primary display. */
  displayBounds: { x: number; y: number; width: number; height: number }
}

/**
 * Why a mini app's tile carries a dot. Derived by main, identical in every window; an
 * entry exists only while at least one reason does.
 */
export type CacheMiniAppAttention = {
  appId: string
  /** The version the last update check found, or null. */
  updateVersion: string | null
  /** Leaves a Cherry release added under a namespace the app declared, still awaiting the user. */
  pendingPermissions: string[]
  /** An update in flight: the version landing, and how far its download is (`null` = not measurable yet). */
  updating: { version: string; fraction: number | null } | null
}

/**
 * Follow-up message queue for one conversation (composer queue mode).
 *
 * While a turn streams, the composer enqueues follow-up drafts here and
 * auto-sends the head when the topic goes idle. The queue is serialized into
 * the renderer persist cache so pending follow-ups survive app restarts; the
 * renderer re-validates entries on load (the cache holds arbitrary JSON).
 */
export type FollowupQueueToken = CacheComposerSerializedToken

export type FollowupQueueDraft = {
  text: string
  tokens: FollowupQueueToken[]
}

export type FollowupQueueItem = {
  id: string
  draft: FollowupQueueDraft
  /** Send-ready payload captured at enqueue time (text + parts + files/models). */
  payload: ComposerQueuedMessagePayload
}

export type FollowupQueueState = {
  items: FollowupQueueItem[]
  paused: boolean
}

/** Per-conversation follow-up queues, keyed by the composer's conversation scope key. */
export type FollowupQueues = Record<string, FollowupQueueState>
