import { ArrowUpCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'

export function AgentUpgradeControl({
  latestVersion,
  upgrading,
  disabled,
  onUpgrade
}: {
  latestVersion?: string
  upgrading: boolean
  disabled: boolean
  onUpgrade: () => void
}) {
  const { t } = useTranslation()
  const label = latestVersion
    ? t(upgrading ? 'code.upgrading_to' : 'code.upgrade_to', {
        version: latestVersion.startsWith('v') ? latestVersion : `v${latestVersion}`
      })
    : t(upgrading ? 'code.upgrading' : 'code.upgrade')

  return (
    <Tooltip content={label} placement="right" classNames={{ placeholder: 'inline-flex shrink-0' }}>
      <Button
        variant="ghost"
        size="icon"
        className="size-5 shrink-0 rounded-md disabled:opacity-100"
        aria-label={label}
        aria-busy={upgrading}
        disabled={disabled || upgrading}
        onClick={onUpgrade}>
        {upgrading ? (
          <Loader2 className="lucide-custom size-3.5 animate-spin text-warning" />
        ) : (
          <ArrowUpCircle className="lucide-custom size-3.5 text-warning" />
        )}
      </Button>
    </Tooltip>
  )
}
