import { CircleX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalOutcome as ToolApprovalOutcomeValue } from '@renderer/types/mcpTool'
import { withUserDenialFeedback } from '@shared/ai/toolDenialFeedback'

interface Props {
  approval?: ToolApprovalOutcomeValue
}

export function ToolApprovalOutcome({ approval }: Props) {
  const { t } = useTranslation()

  if (approval?.approved !== false) return null

  const userReason = approval?.reason?.trim()
  // Show the wording the model was given, so a denied card and its tool result read the same.
  const reason = userReason || withUserDenialFeedback()

  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
      <CircleX aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" size={13} strokeWidth={1.8} />
      <div className="min-w-0">
        <div className="font-medium text-foreground">{t('agent.toolPermission.decisionDenied')}</div>
        <div className="whitespace-pre-wrap break-words text-muted-foreground">
          {userReason && <span className="sr-only">{t('agent.toolPermission.reasonLabel')}: </span>}
          {reason}
        </div>
      </div>
    </div>
  )
}
