import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('useAgentWorkspaceWarning')

export function useAgentWorkspaceStatus(
  workspacePath: string | undefined,
  enabled = true,
  refreshKey = 0,
  sessionId?: string
) {
  const { t } = useTranslation()
  // Each visit/check has its own identity, including A -> B -> A with the same refresh key.
  const check = useMemo(
    () => ({ workspacePath, enabled, refreshKey, sessionId }),
    [workspacePath, enabled, refreshKey, sessionId]
  )
  const [result, setResult] = useState<{ check: typeof check; available: boolean }>()

  useEffect(() => {
    if (!enabled) return
    if (!workspacePath) {
      setResult(undefined)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const accessible = await ipcApi.request('ai.agent.workspace.is_accessible', {
          path: AbsoluteFilePathSchema.parse(workspacePath)
        })
        if (cancelled) return
        setResult({ check, available: accessible })
      } catch (error) {
        logger.warn('Failed to check agent workspace path status', error as Error)
        if (!cancelled) setResult(undefined)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [check, enabled, workspacePath])

  const available = !workspacePath ? true : enabled && result?.check === check ? result.available : undefined
  return {
    available,
    warning: available === false ? t('agent.session.workspace_status.inaccessible', { path: workspacePath }) : undefined
  }
}

export function useAgentWorkspaceWarning(
  workspacePath: string | undefined,
  enabled = true,
  refreshKey = 0,
  sessionId?: string
) {
  return useAgentWorkspaceStatus(workspacePath, enabled, refreshKey, sessionId).warning
}
