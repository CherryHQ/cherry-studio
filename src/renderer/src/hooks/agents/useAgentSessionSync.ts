/**
 * Listens for `AgentSession_Updated` broadcasts from Main (emitted by
 * TopicNamingService after the auto-rename hook fires) and patches the
 * relevant SWR caches so the session list + detail UIs pick up the new
 * name without a refetch.
 */

import { DEFAULT_SESSION_PAGE_SIZE } from '@renderer/api/agent'
import type { AgentSessionEntity, ListAgentSessionsResponse } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect } from 'react'
import { mutate } from 'swr'
import { unstable_serialize } from 'swr/infinite'

import { useAgentClient } from './useAgentClient'

interface AgentSessionUpdatedPayload {
  sessionId: string
  agentId: string
  name: string
}

export function useAgentSessionSync() {
  const client = useAgentClient()

  useEffect(() => {
    if (!client || !window.electron?.ipcRenderer) return

    const removeListener = window.electron.ipcRenderer.on(
      IpcChannel.AgentSession_Updated,
      (_event, payload: AgentSessionUpdatedPayload) => {
        const paths = client.getSessionPaths(payload.agentId)
        const itemKey = paths.withId(payload.sessionId)
        const infKey = unstable_serialize(() => [paths.base, 0, DEFAULT_SESSION_PAGE_SIZE])

        void mutate<AgentSessionEntity>(itemKey, (prev) => (prev ? { ...prev, name: payload.name } : prev), {
          revalidate: false
        })
        void mutate<ListAgentSessionsResponse[]>(
          infKey,
          (prev) => {
            if (!prev) return prev
            return prev.map((page) => ({
              ...page,
              data: page.data.map((session) =>
                session.id === payload.sessionId ? { ...session, name: payload.name } : session
              )
            }))
          },
          { revalidate: false }
        )
      }
    )

    return () => {
      removeListener()
    }
  }, [client])
}
