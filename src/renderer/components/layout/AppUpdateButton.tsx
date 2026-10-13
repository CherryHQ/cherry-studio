import { CircleArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip, type TooltipProps } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { cn } from '@renderer/utils/style'

const logger = loggerService.withContext('AppUpdateButton')

export function AppUpdateButton({
  className,
  tooltipPlacement = 'bottom'
}: {
  className?: string
  tooltipPlacement?: TooltipProps['placement']
}) {
  const { t } = useTranslation()
  const { appUpdateState } = useAppUpdateState()
  const releaseInfo = appUpdateState.info
  if (!appUpdateState.available || !appUpdateState.downloaded || !releaseInfo) return null

  const handleUpdateClick = () => {
    void import('@renderer/components/UpdateDialogPopup')
      .then(({ default: UpdateDialogPopup }) => UpdateDialogPopup.show({ releaseInfo }))
      .catch((error) => logger.error('Failed to open update dialog', error as Error))
  }

  const updateLabel = t('settings.about.updateAvailable', { version: releaseInfo.version })

  return (
    <Tooltip content={updateLabel} placement={tooltipPlacement} delay={800}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={updateLabel}
        onClick={handleUpdateClick}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-accent',
          className
        )}>
        <CircleArrowUp className="lucide-custom size-[18px] text-success" strokeWidth={1.8} />
      </Button>
    </Tooltip>
  )
}
