import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useAgentWorkspaceWarning')

export function useAgentWorkspaceWarning(workspacePath: string | undefined, enabled = true) {
  const { t } = useTranslation()
  const [warning, setWarning] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return
    if (!workspacePath) {
      setWarning(undefined)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const meta = await ipcApi.request(
          'file.get_metadata',
          createFilePathHandle(AbsoluteFilePathSchema.parse(workspacePath))
        )
        if (cancelled) return
        setWarning(
          meta?.kind === 'directory'
            ? undefined
            : t('agent.session.workspace_status.inaccessible', { path: workspacePath })
        )
      } catch (error) {
        logger.warn('Failed to check agent workspace path status', error as Error)
        if (!cancelled) setWarning(undefined)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, t, workspacePath])

  return warning
}
