import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Divider marking where the runtime lost the prior CLI conversation (stale resume target) and
 * continued on a fresh one — the reply below it has no memory of earlier turns.
 */
const ConversationResetBlock: React.FC = () => {
  const { t } = useTranslation()

  return (
    <div className="my-3 flex w-full items-center gap-3 text-muted-foreground" role="separator">
      <span className="h-px min-w-6 flex-1 border-border-subtle border-t border-dashed" aria-hidden />
      <span className="shrink-0 text-xs">{t('message.conversation_reset')}</span>
      <span className="h-px min-w-6 flex-1 border-border-subtle border-t border-dashed" aria-hidden />
    </div>
  )
}

export default React.memo(ConversationResetBlock)
