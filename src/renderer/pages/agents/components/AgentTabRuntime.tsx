import { useEffect } from 'react'

import { cacheService } from '@data/CacheService'
import type { AgentSessionSource } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'

type Props = {
  activeSessionId?: string | null
  activeSessionSource: AgentSessionSource
  onToggleSidebar: () => void
}

export function AgentTabRuntime({ activeSessionId, activeSessionSource, onToggleSidebar }: Props) {
  const isActiveTab = useIsActiveTab()

  useCommandHandler('app.sidebar.toggle', onToggleSidebar, { enabled: isActiveTab })

  useEffect(() => {
    if (!isActiveTab) return
    if (activeSessionId && activeSessionSource === 'query') {
      cacheService.setPersist('ui.agent.last_used_session_id', activeSessionId)
    }
  }, [isActiveTab, activeSessionId, activeSessionSource])

  return null
}
