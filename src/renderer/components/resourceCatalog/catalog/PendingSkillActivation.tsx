import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button } from '@cherrystudio/ui'

export function PendingSkillActivation({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  const { t } = useTranslation()
  const descriptionId = useId()

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge className="border-warning-border bg-warning-subtle text-warning-subtle-foreground">
        {t('settings.skills.pendingActivation')}
      </Badge>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {t('settings.skills.pendingActivationDescription')}
      </p>
      <Button variant="outline" size="sm" disabled={disabled} aria-describedby={descriptionId} onClick={onConfirm}>
        {t('settings.skills.enableForAgents')}
      </Button>
    </div>
  )
}
