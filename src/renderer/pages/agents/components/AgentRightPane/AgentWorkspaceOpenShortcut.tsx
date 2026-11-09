import { useTranslation } from 'react-i18next'

import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { usePreferredExternalOpenTarget } from '@renderer/hooks/useExternalOpenTargets'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'

export function AgentWorkspaceOpenShortcut({ workspacePath }: { workspacePath: string }) {
  const { t } = useTranslation()
  const isActiveTab = useIsActiveTab()
  const { selectedTarget, openTarget } = usePreferredExternalOpenTarget(workspacePath, 'directory')

  useCommandHandler(
    'agent.workspace.open',
    async () => {
      if (!selectedTarget) return
      try {
        await openTarget(selectedTarget)
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: workspacePath })))
      }
    },
    { enabled: isActiveTab && !!selectedTarget }
  )

  return null
}
