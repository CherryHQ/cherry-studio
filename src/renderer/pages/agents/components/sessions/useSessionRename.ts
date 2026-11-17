import { type RefObject, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import type { useUpdateSession } from '@renderer/hooks/agent/useSession'
import { toast } from '@renderer/services/toast'
import type { SessionListItem } from '@renderer/utils/chat/sessionListHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

const logger = loggerService.withContext('AgentSessions')

interface UseSessionRenameOptions {
  renameSessionOptimistically: (
    item: SessionListItem,
    name: string,
    persist: () => Promise<boolean>
  ) => Promise<boolean>
  sessionItems: readonly SessionListItem[]
  sessionItemsRef: RefObject<readonly SessionListItem[]>
  updateSession: ReturnType<typeof useUpdateSession>['updateSession']
}

export function useSessionRename({
  renameSessionOptimistically,
  sessionItems,
  sessionItemsRef,
  updateSession
}: UseSessionRenameOptions) {
  const { t } = useTranslation()
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessionItemsRef.current.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      try {
        const renamed = await renameSessionOptimistically(session, trimmedName, async () =>
          Boolean(
            await updateSession({ id, name: trimmedName, isNameManuallyEdited: true }, { showSuccessToast: false })
          )
        )
        if (renamed) {
          toast.success(t('common.saved'))
        }
      } catch (err) {
        logger.error('Failed to rename session', { err, sessionId: id })
        toast.error(t('agent.session.update.error.failed'))
      }
    },
    [renameSessionOptimistically, sessionItemsRef, t, updateSession]
  )
  const handleOpenRenameSessionDialog = useCallback((session: AgentSessionEntity) => {
    setRenamingSessionId(session.id)
  }, [])
  const handleRenameSessionFromDialog = useCallback(
    (name: string) => (renamingSessionId ? handleRenameSession(renamingSessionId, name) : undefined),
    [handleRenameSession, renamingSessionId]
  )
  const renamingSession = renamingSessionId
    ? sessionItems.find((session) => session.id === renamingSessionId)
    : undefined

  useEffect(() => {
    if (renamingSessionId && !renamingSession) setRenamingSessionId(null)
  }, [renamingSession, renamingSessionId])

  return {
    handleOpenRenameSessionDialog,
    handleRenameSession,
    handleRenameSessionFromDialog,
    renamingSession,
    setRenamingSessionId
  }
}
