import { Copy } from 'lucide-react'
import type { FC } from 'react'

import { Button } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { formatErrorDetails } from '@renderer/utils/errorDetails'

interface ErrorFallbackDetailsProps {
  error: unknown
}

/** Raw text stays collapsed so the fallback reads in one language until the user asks for details. */
const ErrorFallbackDetails: FC<ErrorFallbackDetailsProps> = ({ error }) => (
  <details>
    <summary className="cursor-pointer select-none">{i18n.t('error.diagnosis.view_details')}</summary>
    <pre className="selectable mt-2 whitespace-pre-wrap break-words font-sans">{formatErrorDetails(error)}</pre>
  </details>
)

const ErrorFallbackCopyButton: FC<ErrorFallbackDetailsProps> = ({ error }) => {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatErrorDetails(error))
      toast.success(i18n.t('common.copied'))
    } catch {
      toast.error(i18n.t('common.copy_failed'))
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-label={i18n.t('common.copy')}>
      <Copy size={14} />
      {i18n.t('common.copy')}
    </Button>
  )
}

export { ErrorFallbackCopyButton, ErrorFallbackDetails }
