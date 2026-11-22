import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('useAgentWorkspaceWarning')

export function useAgentWorkspaceStatus(workspacePath: string | undefined, enabled = true, refreshKey = 0) {
  const { t } = useTranslation()
  const [result, setResult] = useState<{ path: string; revision: number; available: boolean }>()

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
        setResult({ path: workspacePath, revision: refreshKey, available: accessible })
      } catch (error) {
        logger.warn('Failed to check agent workspace path status', error as Error)
        if (!cancelled) setResult(undefined)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, refreshKey, t, workspacePath])

  const available = !workspacePath
    ? true
    : enabled && result?.path === workspacePath && result.revision === refreshKey
      ? result.available
      : undefined
  return {
    available,
    warning: available === false ? t('agent.session.workspace_status.inaccessible', { path: workspacePath }) : undefined
  }
}

export function useAgentWorkspaceWarning(workspacePath: string | undefined, enabled = true, refreshKey = 0) {
  return useAgentWorkspaceStatus(workspacePath, enabled, refreshKey).warning
}
