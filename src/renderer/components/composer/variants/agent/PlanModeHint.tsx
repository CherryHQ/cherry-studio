import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { PermissionModeIcon } from '@renderer/components/PermissionModeOption'

export const PlanModeHint = ({ onAccept, onDismiss }: { onAccept: () => void; onDismiss: () => void }) => {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-popover px-3 py-1.5 text-popover-foreground text-sm shadow-md">
      <PermissionModeIcon mode="plan" size={16} />
      <span className="min-w-0 flex-1 truncate">{t('agent.input.plan_hint.label')}</span>
      <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
        {t('agent.input.plan_hint.shortcut')}
      </kbd>
      <Button size="sm" className="shrink-0" onClick={onAccept}>
        {t('agent.input.plan_hint.use')}
      </Button>
      <button
        type="button"
        aria-label={t('agent.input.plan_hint.dismiss')}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  )
}
