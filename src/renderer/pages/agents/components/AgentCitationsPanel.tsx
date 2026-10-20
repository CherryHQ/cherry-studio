import type { ComponentProps } from 'react'
import { lazy, useCallback } from 'react'

import { useAgentRightPaneActions } from './AgentRightPane'

const CitationsPanel = lazy(() => import('@renderer/components/chat/citations/CitationsPanel'))

export default function AgentCitationsPanel(props: Omit<ComponentProps<typeof CitationsPanel>, 'openBrowserUrl'>) {
  const { openBrowserUrl } = useAgentRightPaneActions()
  const { onClose } = props
  const openCitationInBrowser = useCallback(
    (url: string) => {
      openBrowserUrl?.(url)
      onClose()
    },
    [onClose, openBrowserUrl]
  )

  return <CitationsPanel {...props} openBrowserUrl={openBrowserUrl ? openCitationInBrowser : undefined} />
}
