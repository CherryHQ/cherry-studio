import Droplet from 'lucide-react/dist/esm/icons/droplet'
import Pin from 'lucide-react/dist/esm/icons/pin'
import X from 'lucide-react/dist/esm/icons/x'
import type { ComponentProps, FC, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Slider, Tooltip } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

interface SelectionAgentHeaderProps {
  avatar?: ReactNode
  title: string
  subtitle?: string
  isPinned: boolean
  onTogglePin: () => void
  opacity: number
  onOpacityChange: (opacity: number) => void
}

/** The 44px header: drag region, agent and session names, then the window controls. */
export const SelectionAgentHeader: FC<SelectionAgentHeaderProps> = ({
  avatar,
  title,
  subtitle,
  isPinned,
  onTogglePin,
  opacity,
  onOpacityChange
}) => {
  const { t } = useTranslation()
  const [showOpacitySlider, setShowOpacitySlider] = useState(false)

  return (
    <div
      className={cn(
        'flex h-11 shrink-0 items-center gap-2 pr-2 [-webkit-app-region:drag]',
        isMac ? 'pl-[78px]' : 'pl-3.5'
      )}>
      {avatar && (
        <span className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-sm bg-muted text-sm leading-none">
          {avatar}
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <span className="max-w-1/2 shrink-0 truncate font-medium text-foreground">{title}</span>
        {subtitle && <span className="truncate text-muted-foreground">{subtitle}</span>}
      </div>
      <div className="relative flex shrink-0 gap-0.5 [-webkit-app-region:no-drag]">
        <Tooltip
          content={isPinned ? t('selection.action.window.pinned') : t('selection.action.window.pin')}
          placement="bottom">
          <HeaderButton
            aria-label={t('selection.action.window.pin')}
            aria-pressed={isPinned}
            onClick={onTogglePin}
            className={isPinned ? 'bg-accent text-accent-foreground hover:bg-accent' : ''}>
            <Pin className={cn('size-3.5 transition-transform', isPinned && 'rotate-45')} />
          </HeaderButton>
        </Tooltip>
        <Tooltip
          content={t('selection.action.window.opacity')}
          placement="bottom"
          isOpen={showOpacitySlider ? false : undefined}>
          <HeaderButton
            aria-label={t('selection.action.window.opacity')}
            onClick={() => setShowOpacitySlider(!showOpacitySlider)}
            className={showOpacitySlider ? 'bg-accent text-accent-foreground hover:bg-accent' : ''}>
            <Droplet className="size-3.5" />
          </HeaderButton>
        </Tooltip>
        {showOpacitySlider && (
          <div className="absolute top-full right-0 z-[80] mt-2 flex h-[120px] items-center justify-center rounded bg-popover px-2 pt-4 pb-3 shadow-md">
            <Slider
              className="data-[orientation=vertical]:min-h-0"
              orientation="vertical"
              min={20}
              max={100}
              value={[opacity]}
              onValueChange={([value]) => typeof value === 'number' && onOpacityChange(value)}
              onValueCommit={() => setShowOpacitySlider(false)}
              showValueLabel
              formatValueLabel={(value) => `${value}%`}
            />
          </div>
        )}
        {!isMac && <SelectionAgentCloseButton />}
      </div>
    </div>
  )
}

export const SelectionAgentCloseButton: FC = () => {
  const { t } = useTranslation()
  return (
    <HeaderButton
      aria-label={t('common.close')}
      onClick={() => void ipcApi.request('window.close')}
      className="hover:bg-destructive hover:text-destructive-foreground">
      <X className="size-3.5" />
    </HeaderButton>
  )
}

const HeaderButton: FC<ComponentProps<typeof Button>> = ({ className, ...props }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    className={cn(
      'rounded-md border-0 bg-transparent p-0 text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-accent-foreground',
      className
    )}
    {...props}
  />
)
