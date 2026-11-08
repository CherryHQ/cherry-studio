import { LRUCache } from 'lru-cache'

import { ipcApi } from '@renderer/ipc'
import type { AiToolResultReadOptions, AiToolResultResponse, DeferredToolResultRef } from '@shared/ai/transport'

export type ToolResultSnapshot =
  | AiToolResultResponse
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }

const IDLE: ToolResultSnapshot = Object.freeze({ status: 'idle' })
const PREVIEW: AiToolResultReadOptions = Object.freeze({ purpose: 'preview' })
const CACHE_BYTES = 16 * 1024 * 1024

interface Entry {
  ref: DeferredToolResultRef
  options: AiToolResultReadOptions
  state: ToolResultSnapshot
  listeners: Set<(state: ToolResultSnapshot) => void>
  request?: Promise<AiToolResultResponse>
}

interface CachedResult {
  ref: DeferredToolResultRef
  response: AiToolResultResponse
}

function key(ref: DeferredToolResultRef, options: AiToolResultReadOptions): string {
  return JSON.stringify([
    ref.topicId,
    ref.messageId,
    ref.toolCallId,
    options.purpose,
    options.purpose === 'text-range' ? (options.cursor ?? 0) : 0
  ])
}

/** Latest-value details, shared by mounted consumers and retained only within a byte-bounded LRU. */
export class ToolResultService {
  private readonly entries = new Map<string, Entry>()
  private readonly owners = new Map<string, number>()
  private readonly cache = new LRUCache<string, CachedResult>({
    maxSize: CACHE_BYTES,
    sizeCalculation: ({ response }) => new TextEncoder().encode(JSON.stringify(response)).byteLength
  })

  getSnapshot(ref: DeferredToolResultRef, options: AiToolResultReadOptions = PREVIEW): ToolResultSnapshot {
    const id = key(ref, options)
    return this.cache.get(id)?.response ?? this.entries.get(id)?.state ?? IDLE
  }

  retainTopic(topicId: string): () => void {
    this.owners.set(topicId, (this.owners.get(topicId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.owners.get(topicId) ?? 1) - 1
      if (remaining > 0) this.owners.set(topicId, remaining)
      else {
        this.owners.delete(topicId)
        this.clearTopic(topicId)
      }
    }
  }

  subscribe(
    ref: DeferredToolResultRef,
    options: AiToolResultReadOptions,
    listener: (state: ToolResultSnapshot) => void
  ): () => void {
    const id = key(ref, options)
    const entry = this.entry(ref, options)
    entry.listeners.add(listener)
    if (!this.cache.has(id)) void this.read(ref, options).catch(() => {})
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0 && this.entries.get(id) === entry) this.entries.delete(id)
    }
  }

  read(ref: DeferredToolResultRef, options: AiToolResultReadOptions = PREVIEW): Promise<AiToolResultResponse> {
    const id = key(ref, options)
    const cached = this.cache.get(id)
    if (cached) return Promise.resolve(cached.response)
    const entry = this.entry(ref, options)
    if (entry.request) return entry.request
    this.notify(entry, { status: 'loading' })
    const request: Promise<AiToolResultResponse> = ipcApi
      .request('ai.tool.get_result', { ...ref, ...options })
      .then<AiToolResultResponse, AiToolResultResponse>(
        (response) => {
          if (this.entries.get(id) !== entry || entry.request !== request) {
            return this.entries.get(id)?.request ?? this.cache.get(id)?.response ?? { status: 'pending' }
          }
          entry.request = undefined
          if (response.status === 'ready') {
            this.cache.set(id, { ref, response })
            entry.state = IDLE
          } else entry.state = response
          this.notify(entry, response)
          if (entry.listeners.size === 0) this.entries.delete(id)
          return response
        },
        (error: unknown) => {
          if (this.entries.get(id) !== entry || entry.request !== request) {
            return this.entries.get(id)?.request ?? this.cache.get(id)?.response ?? { status: 'pending' }
          }
          entry.request = undefined
          const failure = error instanceof Error ? error : new Error(String(error))
          this.notify(entry, { status: 'error', error: failure })
          if (entry.listeners.size === 0) this.entries.delete(id)
          throw failure
        }
      )
    entry.request = request
    return request
  }

  invalidate(ref: DeferredToolResultRef): void {
    this.invalidateMatching(
      (candidate) =>
        candidate.topicId === ref.topicId &&
        candidate.messageId === ref.messageId &&
        candidate.toolCallId === ref.toolCallId
    )
  }

  invalidateTopic(topicId: string): void {
    this.invalidateMatching((ref) => ref.topicId === topicId)
  }

  private entry(ref: DeferredToolResultRef, options: AiToolResultReadOptions): Entry {
    const id = key(ref, options)
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { ref, options, state: IDLE, listeners: new Set() }
      this.entries.set(id, entry)
    }
    return entry
  }

  private notify(entry: Entry, state: ToolResultSnapshot): void {
    if (state.status !== 'ready') entry.state = state
    for (const listener of entry.listeners) listener(state)
  }

  private invalidateMatching(matches: (ref: DeferredToolResultRef) => boolean): void {
    for (const [id, cached] of this.cache) if (matches(cached.ref)) this.cache.delete(id)
    for (const [id, entry] of this.entries) {
      if (!matches(entry.ref)) continue
      entry.request = undefined
      entry.state = IDLE
      if (entry.listeners.size > 0) void this.read(entry.ref, entry.options).catch(() => {})
      else this.entries.delete(id)
    }
  }

  private clearTopic(topicId: string): void {
    for (const [id, cached] of this.cache) if (cached.ref.topicId === topicId) this.cache.delete(id)
    for (const [id, entry] of this.entries) {
      if (entry.ref.topicId !== topicId) continue
      this.entries.delete(id)
      this.notify(entry, IDLE)
    }
  }
}

export const toolResultService = new ToolResultService()
