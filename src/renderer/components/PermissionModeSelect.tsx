import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import type { PermissionMode } from '@renderer/types/agent'
import { permissionModeCards } from '@renderer/utils/agent'
import { useTranslation } from 'react-i18next'

import { PermissionModeIcon, PermissionModeOptionLabel } from './PermissionModeOption'

type PermissionModeSelectProps = {
  value: PermissionMode
  onValueChange: (value: PermissionMode) => void
  portalContainer: HTMLElement | null
}

export function PermissionModeSelect({ value, onValueChange, portalContainer }: PermissionModeSelectProps) {
  const { t } = useTranslation()
  const selectedCard = permissionModeCards.find((card) => card.mode === value)

  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as PermissionMode)}>
      <SelectTrigger
        className="h-9 w-full rounded-md"
        aria-label={t('library.config.agent.field.permission_mode.label')}>
        <SelectValue>
          {selectedCard ? (
            <span className={selectedCard.dangerous ? 'text-destructive' : undefined}>
              {t(selectedCard.titleKey, selectedCard.titleFallback)}
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent {...(portalContainer ? { portalContainer } : {})}>
        {permissionModeCards.map((card) => (
          <SelectItem key={card.mode} value={card.mode}>
            <div className="flex items-center gap-2">
              <PermissionModeIcon mode={card.mode} size={16} />
              <PermissionModeOptionLabel card={card} t={t} />
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
