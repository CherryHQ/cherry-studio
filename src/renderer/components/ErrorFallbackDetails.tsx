import { Button } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { formatErrorDetails } from '@renderer/utils/errorDetails'
import { Copy } from 'lucide-react'
import type { FC } from 'react'

interface ErrorFallbackDetailsProps {
  error: unknown
}

const ErrorFallbackDetails: FC<ErrorFallbackDetailsProps> = ({ error }) => (
  <pre className="selectable whitespace-pre-wrap break-words font-sans">{formatErrorDetails(error)}</pre>
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
