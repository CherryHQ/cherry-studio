import { ChevronRight, Copy } from 'lucide-react'
import type { FC } from 'react'

import { Button } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { formatErrorDetails } from '@renderer/utils/errorDetails'

interface ErrorFallbackDetailsProps {
  error: unknown
}

const ErrorFallbackDetails: FC<ErrorFallbackDetailsProps> = ({ error }) => (
  <details className="group min-w-0 text-muted-foreground">
    <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md py-1 text-xs outline-none focus-visible:bg-accent [&::-webkit-details-marker]:hidden">
      <ChevronRight className="size-3 shrink-0 group-open:rotate-90" />
      {i18n.t('error.boundary.details')}
    </summary>
    <pre className="selectable mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 [overflow-wrap:anywhere]">
      {formatErrorDetails(error)}
    </pre>
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
