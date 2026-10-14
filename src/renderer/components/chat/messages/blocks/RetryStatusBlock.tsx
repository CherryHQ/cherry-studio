import { RefreshCw } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { RetryPartData } from '@shared/data/types/uiParts'

/**
 * Live status shown while a chat model call is being retried or failed over to
 * a fallback model. Transient: the main process strips the underlying
 * `data-retry` part before persistence, so it only appears during streaming.
 */
const RetryStatusBlock: React.FC<{ data: RetryPartData }> = ({ data }) => {
  const { t } = useTranslation()
  if (data.state === 'settled') return null

  return (
    <div className="mb-1.25 flex flex-row items-center gap-1.5 text-muted-foreground text-xs" title={data.reason}>
      <RefreshCw size={12} className="animate-spin" />
      <span>{t('message.retry.status', { model: data.modelId, attempt: data.attempt })}</span>
    </div>
  )
}

export default React.memo(RetryStatusBlock)
