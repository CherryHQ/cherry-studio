import { ipcApi } from '@renderer/ipc'
import type { DeferredToolResultRef } from '@shared/ai/transport'
import useSWRImmutable from 'swr/immutable'

/**
 * Resolves a tool output that was too large to cross the process boundary. Main decides where it
 * actually lives (active stream or SQLite) — see `ai.get_tool_result`.
 *
 * SWR supplies the deduplication and cross-remount cache this needs: a virtualized message list
 * unmounts and remounts the same card as it scrolls, and several cards can ask at once.
 */
export function useToolResult(ref: DeferredToolResultRef | undefined) {
  const { data, error, isLoading } = useSWRImmutable(
    ref ? `tool-result:${ref.topicId}\0${ref.messageId}\0${ref.toolCallId}` : null,
    async () => {
      const response = await ipcApi.request('ai.get_tool_result', ref!)
      if (!response.found) throw new Error(`Tool result is no longer available: ${ref!.toolCallId}`)
      return response.output
    },
    // A miss is permanent — neither the active stream nor SQLite holds the output — so backing off
    // and asking again only burns IPC round trips. Matches `useDataApi`'s default.
    { shouldRetryOnError: false }
  )

  return { output: data, error, isLoading }
}
