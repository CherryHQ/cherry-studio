import { CircleArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

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
      variant="ghost"
      size="sm"
      className={cn(
        'h-6 min-h-6 shrink-0 gap-1 px-1 hover:bg-transparent',
        onUpgrade
          ? 'text-warning-subtle-foreground hover:text-warning-subtle-foreground dark:text-warning dark:hover:text-warning'
          : 'text-muted-foreground disabled:opacity-100'
      )}
      disabled={disabled || !onUpgrade}
      loading={upgrading}
      loadingIconClassName="size-3.5"
      onClick={onUpgrade}>
      {!upgrading && <CircleArrowUp className="size-3.5" aria-hidden />}
      {t(upgrading ? 'code.upgrading_to' : 'code.update_to', { version })}
    </Button>
  )

  return onUpgrade ? (
    button
  ) : (
    <Tooltip content={t('code.update_manually')} delay={0} asChild>
      <span className="inline-flex shrink-0" tabIndex={0}>
        {button}
      </span>
    </Tooltip>
  )
}
