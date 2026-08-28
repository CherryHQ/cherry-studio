import type { ToolApprovalOutcome as ToolApprovalOutcomeValue } from '@renderer/types/mcpTool'
import { CircleX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  approval?: ToolApprovalOutcomeValue
}

export function ToolApprovalOutcome({ approval }: Props) {
  const { t } = useTranslation()
  const reason = approval?.reason?.trim()

  if (approval?.approved !== false) return null

  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
      <CircleX aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" size={13} strokeWidth={1.8} />
      <div className="min-w-0">
        <div className="font-medium text-foreground">{t('agent.toolPermission.decisionDenied')}</div>
        {reason && (
          <div className="whitespace-pre-wrap break-words text-muted-foreground">
            <span className="sr-only">{t('agent.toolPermission.reasonLabel')}: </span>
            {reason}
          </div>
        )}
      </div>
    </div>
  )
}
