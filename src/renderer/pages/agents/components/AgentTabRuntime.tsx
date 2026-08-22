import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { useEffect } from 'react'

type Props = {
  title: string
  emoji?: string | null
  preserveVisuals: boolean
  activeSession?: AgentSessionEntity | null
  activeSessionSource: string
  onToggleSidebar: () => void
}

export function AgentTabRuntime({
  title,
  emoji,
  preserveVisuals,
  activeSession,
  activeSessionSource,
  onToggleSidebar
}: Props) {
  const isActiveTab = useIsActiveTab()
  const [, setLastUsedSessionId] = usePersistCache('ui.agent.last_used_session_id')

  useTabSelfVisuals({
    title,
    emoji,
    appId: 'agents',
    preserveVisuals
  })

  useCommandHandler('app.sidebar.toggle', onToggleSidebar, { enabled: isActiveTab })

  useEffect(() => {
    if (!isActiveTab) return
    if (activeSession?.id && activeSessionSource === 'query') {
      setLastUsedSessionId(activeSession.id)
    }
  }, [isActiveTab, activeSession, activeSessionSource, setLastUsedSessionId])

  return null
}
