import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'

export function AgentUpgradeControl({
  latestVersion,
  upgrading,
  disabled,
  onUpgrade
}: {
  latestVersion: string
  upgrading: boolean
  disabled: boolean
  onUpgrade?: () => void
}) {
  const { t } = useTranslation()
  const version = latestVersion.startsWith('v') ? latestVersion : `v${latestVersion}`
  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 min-h-6 shrink-0 rounded-full border-warning-border bg-warning-subtle px-2.5 text-warning-subtle-foreground hover:bg-warning-subtle focus-visible:bg-warning-subtle"
      disabled={disabled || !onUpgrade}
      loading={upgrading}
      onClick={onUpgrade}>
      {t(upgrading ? 'code.upgrading_to' : 'code.update_to', { version })}
    </Button>
  )

  return onUpgrade ? (
    button
  ) : (
    <Tooltip content={t('code.update_manually')} asChild>
      <span className="inline-flex shrink-0" tabIndex={0}>
        {button}
      </span>
    </Tooltip>
  )
}
