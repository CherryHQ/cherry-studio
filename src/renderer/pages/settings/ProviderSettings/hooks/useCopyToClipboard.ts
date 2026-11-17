import { announce } from '@react-aria/live-announcer'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { toast } from '@renderer/services/toast'

const logger = loggerService.withContext('useCopyToClipboard')

/**
 * Copies text and reports success through `copied`, so the caller can swap its icon in place
 * where the user's attention already is. Success is also announced to screen readers, which
 * cannot see the icon swap. Failures still toast because they need to be noticed.
 */
export function useCopyToClipboard() {
  const { t } = useTranslation()
  const [copied, setCopied] = useTemporaryValue(false)

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        announce(t('common.copied'), 'polite')
      } catch (error) {
        logger.warn('Failed to copy to clipboard', error as Error)
        toast.error(t('common.copy_failed'))
      }
    },
    [setCopied, t]
  )

  return [copied, copy] as const
}
