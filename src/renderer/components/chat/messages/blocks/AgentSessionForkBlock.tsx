import { CornerUpLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'

import { useOptionalMessageListActions } from '../MessageListProvider'

export default function AgentSessionForkBlock({ sourceSessionId }: { sourceSessionId: string }) {
  const { t } = useTranslation()
  const openForkSourceSession = useOptionalMessageListActions()?.openForkSourceSession
  const [opening, setOpening] = useState(false)

  if (!openForkSourceSession) return null

  const openSource = async () => {
    if (opening) return
    setOpening(true)
    try {
      await openForkSourceSession(sourceSessionId)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="my-2">
      <Button
        type="button"
        variant="link"
        className="px-0 text-link! shadow-none"
        loading={opening}
        onClick={openSource}>
        {!opening && <CornerUpLeft aria-hidden="true" className="size-3.5" />}
        {t('agent_session_fork.continue_in_source')}
      </Button>
    </div>
  )
}
