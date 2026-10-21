import type { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import type { AiService } from '@main/ai/AiService'
import type { TraceStorageService } from '@main/ai/observability/storage/TraceStorageService'
import type { ClaudeCodeWarmQueryManager } from '@main/ai/runtime/claudeCode/ClaudeCodeWarmQueryManager'
import type { AiStreamManager } from '@main/ai/streamManager'
import type { RuntimeActivityService } from '@main/core/application/RuntimeActivityService'
import type { CacheService } from '@main/data/CacheService'
import type { DataApiService } from '@main/data/DataApiService'
import type { PreferenceService } from '@main/data/PreferenceService'
import type { IpcApiService } from '@main/ipc/IpcApiService'

import type { WebDbService } from '../database/WebDbService'
import type { WebWindowManager } from '../services/WebWindowManager'

/** The part of the desktop trace store that every chat turn writes to. */
export type WebTraceStorage = Pick<TraceStorageService, 'setTopicId' | 'saveEntity' | 'addSpanEvent' | 'saveSpans'>

interface WebServices {
  DbService: WebDbService
  WindowManager: WebWindowManager
  PreferenceService: PreferenceService
  CacheService: CacheService
  DataApiService: DataApiService
  IpcApiService: IpcApiService
  AiStreamManager: AiStreamManager
  AiService: AiService
  TraceStorageService: WebTraceStorage
  RuntimeActivityService: Pick<RuntimeActivityService, 'begin'>
  AgentSessionRuntimeService: AgentSessionRuntimeService
  ClaudeCodeWarmQueryManager: Pick<ClaudeCodeWarmQueryManager, 'close' | 'closeAgentSessionWarm'>
}

/**
 * Browser stand-in for `@application`, aliased in by the Worker build. The data
 * and chat services resolve only these services through it.
 */
class WebApplication {
  readonly #services = new Map<keyof WebServices, unknown>()

  register<K extends keyof WebServices>(name: K, instance: WebServices[K]): void {
    this.#services.set(name, instance)
  }

  get<K extends keyof WebServices>(name: K): WebServices[K] {
    const instance = this.#services.get(name)
    if (!instance) throw new Error(`Service "${name}" is not available in the Web Core Worker`)
    return instance as WebServices[K]
  }

  /**
   * Paths name files the desktop keeps under its data folder; the Worker never opens them. They are
   * absolute POSIX paths because services store and validate them (e.g. agent workspace paths).
   */
  getPath(namespace: string, filename?: string): string {
    return filename ? `/web/${namespace}/${filename}` : `/web/${namespace}`
  }

  isReady(): boolean {
    return this.#services.has('DbService')
  }
}

export const application = new WebApplication()
