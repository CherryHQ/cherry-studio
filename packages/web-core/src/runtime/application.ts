import type { AiService } from '@main/ai/AiService'
import type { TraceStorageService } from '@main/ai/observability/storage/TraceStorageService'
import type { AiStreamManager } from '@main/ai/streamManager'
import type { RuntimeActivityService } from '@main/core/application/RuntimeActivityService'

import type { WebDbService } from '../database/WebDbService'
import type { WebCacheService } from '../services/WebCacheService'
import type { WebPreferenceService } from '../services/WebPreferenceService'

/** Electron's WindowManager role in the Worker: deliver main-process broadcasts to the page. */
export interface WebWindowManager {
  broadcast(channel: string, payload: unknown): void
}

/** The part of the desktop trace store that every chat turn writes to. */
export type WebTraceStorage = Pick<TraceStorageService, 'setTopicId' | 'saveEntity' | 'addSpanEvent' | 'saveSpans'>

interface WebServices {
  DbService: WebDbService
  WindowManager: WebWindowManager
  PreferenceService: WebPreferenceService
  CacheService: WebCacheService
  AiStreamManager: AiStreamManager
  AiService: AiService
  TraceStorageService: WebTraceStorage
  RuntimeActivityService: Pick<RuntimeActivityService, 'begin'>
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

  isReady(): boolean {
    return this.#services.has('DbService')
  }
}

export const application = new WebApplication()
