import { ipcApi } from '@renderer/ipc'
import type { DeferredToolResultRef } from '@shared/ai/transport'
import { useEffect } from 'react'
import { type Cache, useSWRConfig } from 'swr'
import useSWRImmutable from 'swr/immutable'

interface UseToolResultOptions {
  refreshToken?: string
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

  return { output: data, error, isLoading }
}
