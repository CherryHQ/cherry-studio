import { useEffect } from 'react'

import { cacheService } from '@data/CacheService'
import type { AgentSessionSource } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'

type Props = {
  title: string
  emoji?: string | null
  /** Image avatar URL; takes precedence over `emoji`. */
  icon?: string
  preserveVisuals: boolean
  activeSessionId?: string | null
  activeSessionSource: AgentSessionSource
  onToggleSidebar: () => void
}

export function AgentTabRuntime({
  title,
  emoji,
  icon,
  preserveVisuals,
  activeSessionId,
  activeSessionSource,
  onToggleSidebar
}: Props) {
  const isActiveTab = useIsActiveTab()

  useTabSelfVisuals({
    title,
    emoji,
    icon,
    routePrefix: '/app/agents',
    preserveVisuals
  })

  useCommandHandler('app.sidebar.toggle', onToggleSidebar, { enabled: isActiveTab })

  useEffect(() => {
    if (!isActiveTab) return
    if (activeSessionId && activeSessionSource === 'query') {
      cacheService.setPersist('ui.agent.last_used_session_id', activeSessionId)
    }
  }, [isActiveTab, activeSessionId, activeSessionSource])

  return null
}
