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
  id: string
  ref: DeferredToolResultRef
  options: AiToolResultReadOptions
  state: ToolResultSnapshot
  listeners: Set<(state: ToolResultSnapshot) => void>
  request?: Promise<AiToolResultResponse>
}

function messageKey(topicId: string, messageId: string): string {
  return JSON.stringify([topicId, messageId])
}

function partKey(topicId: string, partId: string): string {
  return JSON.stringify([topicId, partId, 'part'])
}

function key(ref: DeferredToolResultRef, options: AiToolResultReadOptions): string {
  return JSON.stringify([
    ref.topicId,
    ref.partId ?? [ref.messageId, ref.toolCallId],
    options.purpose,
    options.purpose === 'text-range' ? (options.cursor ?? 0) : 0
  ])
}

/** Latest-value details, shared by mounted consumers and retained only within a byte-bounded LRU. */
export class ToolResultService {
  private readonly entries = new Map<string, Entry>()
  private readonly owners = new Map<string, number>()
  private readonly byAddress = new Map<string, Set<Entry>>()
  private readonly cache: LRUCache<Entry, AiToolResultResponse> = new LRUCache({
    maxSize: CACHE_BYTES,
    sizeCalculation: (response) => new TextEncoder().encode(JSON.stringify(response)).byteLength,
    disposeAfter: (_response, entry) => this.releaseIfUnused(entry)
  })

  getSnapshot(ref: DeferredToolResultRef, options: AiToolResultReadOptions = PREVIEW): ToolResultSnapshot {
    const entry = this.entries.get(key(ref, options))
    return entry ? (this.cache.get(entry) ?? entry.state) : IDLE
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
        for (const entry of this.entries.values()) {
          if (entry.ref.topicId !== topicId) continue
          this.remove(entry)
          this.cache.delete(entry)
          this.notify(entry, IDLE)
        }
      }
    }
  }

  subscribe(
    ref: DeferredToolResultRef,
    options: AiToolResultReadOptions,
    listener: (state: ToolResultSnapshot) => void
  ): () => void {
    const entry = this.entry(ref, options)
    entry.listeners.add(listener)
    if (!this.cache.has(entry)) void this.read(ref, options).catch(() => {})
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) {
        entry.request = undefined
        this.releaseIfUnused(entry)
      }
    }
  }

  read(ref: DeferredToolResultRef, options: AiToolResultReadOptions = PREVIEW): Promise<AiToolResultResponse> {
    const entry = this.entry(ref, options)
    const cached = this.cache.get(entry)
    if (cached) return Promise.resolve(cached)
    if (entry.request) return entry.request
    this.notify(entry, { status: 'loading' })
    const request: Promise<AiToolResultResponse> = ipcApi
      .request('ai.tool.get_result', { ...ref, ...options })
      .then<AiToolResultResponse, AiToolResultResponse>(
        (response) => {
          if (entry.request !== request || this.entries.get(entry.id) !== entry) return this.latest(entry.id)
          entry.request = undefined
          if (response.status === 'ready') {
            this.cache.set(entry, response)
            entry.state = IDLE
          } else entry.state = response
          this.notify(entry, response)
          this.releaseIfUnused(entry)
          return response
        },
        (error: unknown) => {
          if (entry.request !== request || this.entries.get(entry.id) !== entry) return this.latest(entry.id)
          entry.request = undefined
          const failure = error instanceof Error ? error : new Error(String(error))
          this.notify(entry, { status: 'error', error: failure })
          this.releaseIfUnused(entry)
          throw failure
        }
      )
    entry.request = request
    return request
  }

  invalidate(ref: DeferredToolResultRef): void {
    if (ref.partId) {
      for (const entry of this.byAddress.get(partKey(ref.topicId, ref.partId)) ?? []) this.invalidateEntry(entry)
    }
    for (const entry of this.byAddress.get(messageKey(ref.topicId, ref.messageId)) ?? []) {
      if ((!ref.partId || !entry.ref.partId) && entry.ref.toolCallId === ref.toolCallId) this.invalidateEntry(entry)
    }
  }

  invalidateMessage(topicId: string, messageId: string): void {
    for (const entry of this.byAddress.get(messageKey(topicId, messageId)) ?? []) this.invalidateEntry(entry)
  }

  invalidateTopic(topicId: string): void {
    for (const entry of this.entries.values()) if (entry.ref.topicId === topicId) this.invalidateEntry(entry)
  }

  private invalidateEntry(entry: Entry): void {
    entry.request = undefined
    entry.state = IDLE
    this.cache.delete(entry)
    if (entry.listeners.size > 0) void this.read(entry.ref, entry.options).catch(() => {})
    else this.releaseIfUnused(entry)
  }

  private latest(id: string): Promise<AiToolResultResponse> | AiToolResultResponse {
    const current = this.entries.get(id)
    return (current && (current.request ?? this.cache.get(current))) ?? { status: 'pending' }
  }

  private entry(ref: DeferredToolResultRef, options: AiToolResultReadOptions): Entry {
    const id = key(ref, options)
    const existing = this.entries.get(id)
    if (existing) return existing
    const entry: Entry = { id, ref, options, state: IDLE, listeners: new Set() }
    this.entries.set(id, entry)
    for (const address of this.addresses(ref)) {
      const entries = this.byAddress.get(address)
      if (entries) entries.add(entry)
      else this.byAddress.set(address, new Set([entry]))
    }
    return entry
  }

  private addresses(ref: DeferredToolResultRef): string[] {
    const row = messageKey(ref.topicId, ref.messageId)
    return ref.partId ? [row, partKey(ref.topicId, ref.partId)] : [row]
  }

  private releaseIfUnused(entry: Entry): void {
    if (!entry.request && !entry.listeners.size && !this.cache.has(entry)) this.remove(entry)
  }

  private remove(entry: Entry): void {
    if (this.entries.get(entry.id) !== entry) return
    this.entries.delete(entry.id)
    for (const address of this.addresses(entry.ref)) {
      const entries = this.byAddress.get(address)
      entries?.delete(entry)
      if (!entries?.size) this.byAddress.delete(address)
    }
  }

  private notify(entry: Entry, state: ToolResultSnapshot): void {
    if (state.status !== 'ready') entry.state = state
    for (const listener of entry.listeners) listener(state)
  }
}

export const toolResultService = new ToolResultService()
