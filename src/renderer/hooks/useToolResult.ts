import { ipcApi } from '@renderer/ipc'
import type { DeferredToolResultRef } from '@shared/ai/transport'
import { useEffect } from 'react'
import useSWRImmutable from 'swr/immutable'

interface UseToolResultOptions {
  refreshToken?: string
}

/**
 * Resolves a tool output deferred at the process boundary. SWR supplies the dedup and
 * cross-remount cache a virtualized message list needs.
 */
export function useToolResult(ref: DeferredToolResultRef | undefined, options: UseToolResultOptions = {}) {
  const cacheKey = ref ? `tool-result:${ref.topicId}\0${ref.messageId}\0${ref.toolCallId}` : null
  const refreshOnChange = options.refreshToken !== undefined
  const { data, error, isLoading, mutate } = useSWRImmutable(
    cacheKey,
    async () => {
      const response = await ipcApi.request('ai.tool.get_result', ref!)
      if (!response.found) throw new Error(`Tool result is no longer available: ${ref!.toolCallId}`)
      return response.output
    },
    // A miss is permanent: neither the active stream nor SQLite holds the output.
    { shouldRetryOnError: false, ...(refreshOnChange ? { revalidateOnMount: false } : {}) }
  )

  useEffect(() => {
    if (!cacheKey || !refreshOnChange) return
    void mutate()
  }, [cacheKey, mutate, options.refreshToken, refreshOnChange])

  return { output: data, error, isLoading }
}
