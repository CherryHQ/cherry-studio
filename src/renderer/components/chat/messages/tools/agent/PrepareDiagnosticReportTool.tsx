import { Check, FilePenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useOptionalMessageListActions } from '@renderer/components/chat/messages/MessageListProvider'

import type { PrepareDiagnosticReportResult } from './prepareDiagnosticReportResult'

export function PrepareDiagnosticReportTool({ result }: { readonly result: PrepareDiagnosticReportResult }) {
  const { t } = useTranslation()
  const openReport = useOptionalMessageListActions()?.openDiagnosticReport

  return (
    <div className="my-1 flex min-h-12 max-w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success-subtle text-success-subtle-foreground">
        <Check aria-hidden="true" size={16} strokeWidth={2} />
      </span>
      <p className="min-w-0 flex-1 text-foreground text-sm">{t('agent.builtin.cherry_support.diagnostics.prepared')}</p>
      {openReport ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => openReport(result.description)}>
          <FilePenLine aria-hidden="true" size={14} />
          {t('agent.builtin.cherry_support.diagnostics.review')}
        </Button>
      ) : null}
    </div>
  )
}
