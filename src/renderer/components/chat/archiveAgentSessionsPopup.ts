import type { TFunction } from 'i18next'

import ConfirmActionPopup from '@renderer/components/popups/ConfirmActionPopup'

interface ArchiveAgentSessionsPopupParams {
  agentName: string
  sessionCount?: number
  t: TFunction
  action: () => void | Promise<void>
}

export const archiveAgentSessionsPopup = {
  show({ agentName, sessionCount, t, action }: ArchiveAgentSessionsPopupParams): Promise<boolean> {
    return ConfirmActionPopup.show({
      title: t('agent.session.archive.trigger'),
      content: t(sessionCount === undefined ? 'agent.session.archive.confirm' : 'agent.session.archive.confirm_count', {
        name: agentName,
        count: sessionCount
      }),
      okText: t('common.archive'),
      cancelText: t('common.cancel'),
      danger: true,
      action
    })
  }
}
