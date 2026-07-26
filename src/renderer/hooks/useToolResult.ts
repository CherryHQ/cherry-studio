import { ipcApi } from '@renderer/ipc'
import type { DeferredToolResultRef } from '@shared/ai/transport'
import useSWRImmutable from 'swr/immutable'

/**
 * Resolves a tool output deferred at the process boundary. SWR supplies the dedup and
 * cross-remount cache a virtualized message list needs.
 */
export function useToolResult(ref: DeferredToolResultRef | undefined) {
  const { data, error, isLoading } = useSWRImmutable(
    ref ? `tool-result:${ref.topicId}\0${ref.messageId}\0${ref.toolCallId}` : null,
    async () => {
      const response = await ipcApi.request('ai.get_tool_result', ref!)
      if (!response.found) throw new Error(`Tool result is no longer available: ${ref!.toolCallId}`)
      return response.output
    },
    // A miss is permanent: neither the active stream nor SQLite holds the output.
    { shouldRetryOnError: false }
  )

  return { output: data, error, isLoading }
}
