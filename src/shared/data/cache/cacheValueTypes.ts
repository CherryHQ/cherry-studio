import type { McpTool } from '@shared/types/mcp'
import type { UpdateInfo } from 'builder-util-runtime'

import type { AgentSessionCompactionState } from '../../ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '../../ai/agentSessionContextUsage'
import type { ExternalAppId } from '../../types/externalApp'
import type { MiniApp } from '../types/miniApp'
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
/**
 * `'topic.active'` caches the renderer's v1 chat topic — renderer-only state.
 * The v2 chat migration removes this outright (feat/chat-page drops both the
 * `'topic.active'` cache key and `CacheTopic`; active topic is managed via
 * DataApi instead). Typed loosely here so the cross-process cache schema does
 * not depend on the renderer's throwaway v1 `Topic` graph; the renderer's own
 * read sites cast the result to `Topic`.
 */
export type CacheTopic = unknown
export type CacheMcpTool = McpTool

export type McpRuntimeStatus = {
  state: 'disabled' | 'connecting' | 'connected' | 'error'
  lastCheckedAt: number
  lastError?: string
}

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
  isPinned?: boolean // 是否置顶（豁免 LRU）
  savedState?: TabSavedState // 休眠前保存的状态
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string
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

export type CachePaintingGenerationState = {
  status: 'running' | 'failed' | 'canceled'
  taskId: string | null
  error: string | null
  progress: number | null
}

export type CacheAgentSessionCompactionState = AgentSessionCompactionState | null
export type CacheAgentSessionContextUsage = AgentSessionContextUsage | null

export type AgentOpenExternalAppTarget = ExternalAppId | 'file_manager' | null
