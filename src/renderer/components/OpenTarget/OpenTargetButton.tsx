import { ChevronDown, FolderOpen } from 'lucide-react'
import { type ComponentProps, type ReactNode, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ButtonGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  NormalTooltip
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
  primaryContent?: ReactNode
  primaryShortcut?: ReactNode
  primaryClassName?: string
  menuClassName?: string
  menuAction?: 'open' | 'select'
  menuContentProps?: Pick<ComponentProps<typeof DropdownMenuContent>, 'className' | 'alignOffset'>
  tooltip?: string
  className?: string
}

export function OpenTargetButton({
  targetPath,
  pathKind,
  primaryContent,
  primaryShortcut,
  primaryClassName,
  menuClassName,
  menuAction = 'open',
  menuContentProps,
  tooltip,
  className
}: OpenTargetButtonProps) {
  const { t } = useTranslation()
  const hasCustomPrimary = primaryContent !== undefined
  const { targets, selectedTarget, openTarget, selectTarget } = usePreferredExternalOpenTarget(targetPath, pathKind)

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
  const menuItems = targets.map((target) => {
    const label = getOpenTargetLabel(target, t)
    const isSelected = selectedTarget?.id === target.id
    const badge = getOpenTargetBadge(target, t)
    const suffix = isSelected ? primaryShortcut : undefined
    const content = (
      <>
        <OpenTargetIcon target={target} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {(badge || suffix) && (
          <span className="flex shrink-0 items-center">
            {badge}
            {suffix}
          </span>
        )}
      </>
    )

    return menuAction === 'select' ? (
      <DropdownMenuRadioItem key={target.id} value={target.id} textValue={label} onSelect={() => selectTarget(target)}>
        {content}
      </DropdownMenuRadioItem>
    ) : (
      <DropdownMenuItem
        key={target.id}
        textValue={label}
        className={cn(isSelected && 'font-medium')}
        onSelect={() => void handleOpen(target)}>
        {content}
      </DropdownMenuItem>
    )
  })

  if (targets.length <= 1) {
    return (
      <NormalTooltip content={tooltip ?? primaryLabel} delayDuration={500}>
        <Button
          type="button"
          variant="ghost"
          size={hasCustomPrimary ? 'sm' : 'icon-sm'}
          disabled={!selectedTarget}
          className={cn(hasCustomPrimary ? primaryClassName : TOOLBAR_BUTTON_CLASS, className)}
          aria-label={hasCustomPrimary ? undefined : primaryLabel}
          onClick={() => void handleOpen()}>
          {primaryContent ?? primaryIcon}
        </Button>
      </NormalTooltip>
    )
  }

  return (
    <ButtonGroup
      attached={hasCustomPrimary}
      className={cn(!hasCustomPrimary && SPLIT_BUTTON_GROUP_CLASS, 'gap-0', className)}>
      <NormalTooltip content={tooltip ?? primaryLabel} delayDuration={500}>
        <Button
          type="button"
          className={cn(
            hasCustomPrimary ? primaryClassName : cn('w-8 min-w-8', SPLIT_BUTTON_CLASS, TOOLBAR_BUTTON_CLASS)
          )}
          variant="ghost"
          size={hasCustomPrimary ? 'sm' : 'icon-sm'}
          aria-label={hasCustomPrimary ? undefined : primaryLabel}
          onClick={() => void handleOpen()}>
          {primaryContent ?? primaryIcon}
        </Button>
      </NormalTooltip>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            className={cn(
              'w-6 min-w-6',
              hasCustomPrimary ? menuClassName : cn(SPLIT_BUTTON_CLASS, TOOLBAR_BUTTON_CLASS)
            )}
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.more')}>
            <ChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={hasCustomPrimary ? 'start' : 'end'}
          {...menuContentProps}
          className={cn('w-56 p-1', menuContentProps?.className)}>
          {menuAction === 'select' ? (
            <DropdownMenuRadioGroup value={selectedTarget?.id}>{menuItems}</DropdownMenuRadioGroup>
          ) : (
            menuItems
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
