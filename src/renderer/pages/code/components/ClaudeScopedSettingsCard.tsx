import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '@cherrystudio/ui'

interface ClaudeScopedSettingsCardProps {
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onToggle: (next: boolean) => void
}

const ClaudeScopedSettingsCard: FC<ClaudeScopedSettingsCardProps> = ({ checked, disabled, busy, onToggle }) => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-background px-4 py-5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{t('code.claude_scope.title')}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t(busy ? 'code.claude_scope.busy' : 'code.claude_scope.description')}
        </div>
      </div>
      <Switch
        aria-label={t('code.claude_scope.title')}
        checked={checked}
        disabled={disabled || busy}
        onCheckedChange={onToggle}
      />
    </div>
  )
}

export default ClaudeScopedSettingsCard
