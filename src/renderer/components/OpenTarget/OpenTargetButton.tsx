import { ChevronDown, FolderOpen } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ButtonGroup,
  MenuItem,
  MenuList,
  NormalTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreferredExternalOpenTarget } from '@renderer/hooks/useExternalOpenTargets'
import type { ExternalOpenTargetPathKind } from '@renderer/services/externalOpenTargetService'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'

import { OpenTargetIcon } from './OpenTargetIcon'
import { getOpenTargetBadge, getOpenTargetLabel } from './openTargetPresentation'

const TOOLBAR_BUTTON_CLASS = 'text-muted-foreground hover:bg-accent hover:text-foreground'
const SPLIT_BUTTON_GROUP_CLASS = 'h-8 overflow-hidden rounded-md border border-border-subtle'
const SPLIT_BUTTON_CLASS = 'h-full rounded-none p-0'

export interface OpenTargetButtonProps {
  targetPath: string
  pathKind: ExternalOpenTargetPathKind
  menuTrigger?: ReactNode
  tooltip?: string
  className?: string
}

export function OpenTargetButton({ targetPath, pathKind, menuTrigger, tooltip, className }: OpenTargetButtonProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const { targets, selectedTarget, openTarget } = usePreferredExternalOpenTarget(targetPath, pathKind)

  const handleOpen = useCallback(
    async (target = selectedTarget) => {
      if (!target) return
      try {
        await openTarget(target)
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: targetPath })))
      }
    },
    [openTarget, selectedTarget, t, targetPath]
  )

  const primaryLabel = selectedTarget
    ? t('common.open_in', { name: selectedTarget.name ?? getOpenTargetLabel(selectedTarget, t) })
    : t('agent.preview_pane.default_app')
  const primaryIcon = selectedTarget ? <OpenTargetIcon target={selectedTarget} /> : <FolderOpen size={16} />
  const menu = (
    <PopoverContent className="w-56 p-1" align={menuTrigger ? 'start' : 'end'}>
      <MenuList>
        {targets.map((target) => (
          <MenuItem
            key={target.id}
            label={getOpenTargetLabel(target, t)}
            icon={<OpenTargetIcon target={target} />}
            suffix={getOpenTargetBadge(target, t)}
            active={selectedTarget?.id === target.id}
            onClick={() => {
              setMenuOpen(false)
              void handleOpen(target)
            }}
          />
        ))}
      </MenuList>
    </PopoverContent>
  )

  if (menuTrigger) {
    const trigger = <PopoverTrigger asChild>{menuTrigger}</PopoverTrigger>
    return (
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        {tooltip ? <NormalTooltip content={tooltip}>{trigger}</NormalTooltip> : trigger}
        {menu}
      </Popover>
    )
  }

  if (targets.length <= 1) {
    return (
      <NormalTooltip content={tooltip ?? primaryLabel} delayDuration={500}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!selectedTarget}
          className={cn(TOOLBAR_BUTTON_CLASS, className)}
          aria-label={primaryLabel}
          onClick={() => void handleOpen()}>
          {primaryIcon}
        </Button>
      </NormalTooltip>
    )
  }

  return (
    <ButtonGroup attached={false} className={cn(SPLIT_BUTTON_GROUP_CLASS, 'gap-0', className)}>
      <NormalTooltip content={tooltip ?? primaryLabel} delayDuration={500}>
        <Button
          type="button"
          className={cn('w-8 min-w-8', SPLIT_BUTTON_CLASS, TOOLBAR_BUTTON_CLASS)}
          variant="ghost"
          size="icon-sm"
          aria-label={primaryLabel}
          onClick={() => void handleOpen()}>
          {primaryIcon}
        </Button>
      </NormalTooltip>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            className={cn('w-6 min-w-6', SPLIT_BUTTON_CLASS, TOOLBAR_BUTTON_CLASS)}
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.more')}>
            <ChevronDown size={14} />
          </Button>
        </PopoverTrigger>
        {menu}
      </Popover>
    </ButtonGroup>
  )
}
