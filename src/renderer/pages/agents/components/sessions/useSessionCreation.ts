import { type RefObject, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { SessionListItem } from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import type { CreateAgentSessionDefaults } from '../../types'
import type { useOptionalAgentFileNavigation } from '../AgentRightPane'
import { createSessionSeedPreservesFileWorkspace, type CreateSessionSeed } from './createSessionSeed'

const logger = loggerService.withContext('AgentSessions')

interface UseSessionCreationOptions {
  activeSessionIdRef: RefObject<string | null>
  agentById: ReadonlyMap<string, unknown>
  agentsForDisplay: readonly { id: string }[]
  onCreateSession?: (
    defaults: CreateAgentSessionDefaults
  ) => AgentSessionEntity | null | void | Promise<AgentSessionEntity | null | void>
  onShowMissingAgentSelection?: () => void | Promise<void>
  requestFileNavigation: ReturnType<typeof useOptionalAgentFileNavigation>
  sessionItemsRef: RefObject<readonly SessionListItem[]>
}

export function useSessionCreation({
  activeSessionIdRef,
  agentById,
  agentsForDisplay,
  onCreateSession,
  onShowMissingAgentSelection,
  requestFileNavigation,
  sessionItemsRef
}: UseSessionCreationOptions) {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const [creatingSession, setCreatingSession] = useState(false)
  const findOrCreateWorkspace = useCallback(
    async (workspacePath: string) => {
      const workspace = await ipcApi.request('ai.agent.workspace.register', {
        path: AbsoluteFilePathSchema.parse(workspacePath)
      })
      await invalidate('/agent-workspaces')
      return workspace
    },
    [invalidate]
  )
  const createSessionFromSeed = useCallback(
    async (seed: CreateSessionSeed | null | undefined) => {
      if (creatingSession) return null
      setCreatingSession(true)
      try {
        const workspace =
          seed?.workspace ??
          (seed?.workspacePath
            ? ({
                type: AGENT_WORKSPACE_TYPE.USER,
                workspaceId: (await findOrCreateWorkspace(seed.workspacePath)).id
              } satisfies AgentSessionWorkspaceSource)
            : ({ type: AGENT_WORKSPACE_TYPE.SYSTEM } satisfies AgentSessionWorkspaceSource))
        const requestedAgentId = seed?.agentId
        const agentId =
          (requestedAgentId && agentById.has(requestedAgentId) ? requestedAgentId : undefined) ??
          agentsForDisplay[0]?.id ??
          null

        if (!onCreateSession) {
          await onShowMissingAgentSelection?.()
          return null
        }

        const createdSession = await onCreateSession({
          agentId,
          workspace
        })

        return createdSession ?? null
      } catch (err) {
        logger.error('Failed to create session from session list', { err, agentId: seed?.agentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        return null
      } finally {
        setCreatingSession(false)
      }
    },
    [
      agentById,
      agentsForDisplay,
      creatingSession,
      findOrCreateWorkspace,
      onShowMissingAgentSelection,
      onCreateSession,
      t
    ]
  )

  const requestCreateSessionFromSeed = useCallback(
    (seed: CreateSessionSeed | null | undefined) => {
      const transition = () => {
        void createSessionFromSeed(seed)
      }
      const activeSession = activeSessionIdRef.current
        ? sessionItemsRef.current.find((session) => session.id === activeSessionIdRef.current)
        : undefined
      if (seed && activeSession && createSessionSeedPreservesFileWorkspace(seed, activeSession)) {
        transition()
        return
      }
      if (requestFileNavigation) {
        requestFileNavigation(transition)
        return
      }
      transition()
    },
    [activeSessionIdRef, createSessionFromSeed, requestFileNavigation, sessionItemsRef]
  )

  return { creatingSession, requestCreateSessionFromSeed }
}
