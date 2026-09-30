import { useEffect } from 'react'
import { type Cache, useSWRConfig } from 'swr'
import useSWRImmutable from 'swr/immutable'

import { ipcApi } from '@renderer/ipc'
import type { DeferredToolResultRef } from '@shared/ai/transport'

interface UseToolResultOptions {
  refreshToken?: string
  /** A running command keeps appending to its deferred result; poll it while this is set. */
  refreshIntervalMs?: number
}

interface ToolResultRequests {
  refreshToken?: string
  pending: Map<string | undefined, Promise<unknown>>
}

class ToolResultRequestCache {
  private readonly providers = new WeakMap<Cache, Map<string, ToolResultRequests>>()

  private getRequests(cache: Cache, key: string): ToolResultRequests {
    let requests = this.providers.get(cache)
    if (!requests) {
      requests = new Map()
      this.providers.set(cache, requests)
    }
    let state = requests.get(key)
    if (!state) {
      state = { pending: new Map() }
      requests.set(key, state)
    }
    return state
  }

  private release(cache: Cache, key: string, state: ToolResultRequests): void {
    const requests = this.providers.get(cache)
    if (state.pending.size || requests?.get(key) !== state) return
    requests.delete(key)
    if (requests.size === 0) this.providers.delete(cache)
  }

  hasPendingRead(cache: Cache, key: string): boolean {
    return Boolean(this.providers.get(cache)?.get(key)?.pending.size)
  }

  read(cache: Cache, key: string, ref: DeferredToolResultRef, refreshToken?: string): Promise<unknown> {
    const state = this.getRequests(cache, key)
    const version = state.refreshToken ?? refreshToken
    const existing = state.pending.get(version)
    if (existing) return existing

    const request = ipcApi
      .request('ai.tool.get_result', ref)
      .then((response) => {
        if (!response.found) throw new Error(`Tool result is no longer available: ${ref.toolCallId}`)
        return response.output
      })
      .finally(() => {
        state.pending.delete(version)
        this.release(cache, key, state)
      })
    state.pending.set(version, request)
    return request
  }

  refresh(cache: Cache, key: string, version: string, revalidate: () => Promise<unknown>): Promise<unknown> {
    const state = this.getRequests(cache, key)
    // SWR may revalidate through another consumer's fetcher, so the requester owns the version.
    state.refreshToken = version
    return revalidate().finally(() => this.release(cache, key, state))
  }
}

const toolResultRequestCache = new ToolResultRequestCache()

/** Resolves deferred tool outputs while preserving SWR's cross-remount cache. */
export function useToolResult(ref: DeferredToolResultRef | undefined, options: UseToolResultOptions = {}) {
  const { cache } = useSWRConfig()
  const cacheKey = ref ? `tool-result:${ref.topicId}\0${ref.messageId}\0${ref.toolCallId}` : null
  const refreshOnChange = options.refreshToken !== undefined
  const { data, error, isLoading, mutate } = useSWRImmutable(
    cacheKey,
    () => toolResultRequestCache.read(cache, cacheKey!, ref!, options.refreshToken),
    // A miss is permanent: neither the active stream nor SQLite holds the output.
    { shouldRetryOnError: false, ...(refreshOnChange ? { revalidateOnMount: false } : {}) }
  )

  useEffect(() => {
    if (!cacheKey || options.refreshToken === undefined) return
    void toolResultRequestCache.refresh(cache, cacheKey, options.refreshToken, mutate).catch(() => undefined)
  }, [cache, cacheKey, mutate, options.refreshToken])

  const refreshIntervalMs = options.refreshIntervalMs
  useEffect(() => {
    if (!cacheKey || refreshIntervalMs === undefined) return
    // An open-ended command appends to its result without changing any status or excerpt the caller
    // could key on, so the only honest signal left is time.
    const timer = setInterval(() => {
      // A read slower than the interval is still in flight; another would stack behind it, not land sooner.
      if (toolResultRequestCache.hasPendingRead(cache, cacheKey)) return
      void toolResultRequestCache
        .refresh(cache, cacheKey, options.refreshToken ?? `interval:${Date.now()}`, mutate)
        .catch(() => undefined)
    }, refreshIntervalMs)
    return () => clearInterval(timer)
  }, [cache, cacheKey, mutate, options.refreshToken, refreshIntervalMs])

  return { output: data, error, isLoading }
}
