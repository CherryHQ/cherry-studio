import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { LoadingIcon } from '@renderer/components/Icons'
import { ChevronDown, CirclePlay, CircleX, ShieldCheck } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalActions, ToolApprovalState } from './hooks/useToolApproval'

export interface ToolApprovalActionsProps extends ToolApprovalState, ToolApprovalActions {
  /** Compact mode for use in headers */
  compact?: boolean
  /** Show abort button when executing */
  showAbort?: boolean
  /** Abort handler */
  onAbort?: () => void
}

/**
 * Unified tool approval action buttons
 * Used in both MessageMcpTool and ToolPermissionRequestCard
 */
export const ToolApprovalActionsComponent: FC<ToolApprovalActionsProps> = ({
  isWaiting,
  isExecuting,
  isSubmitting,
  confirm,
  cancel,
  autoApprove,
  compact = false,
  showAbort = false,
  onAbort
}) => {
  const { t } = useTranslation()

  // Stop event propagation to prevent collapse toggle
  const handleClick = (e: MouseEvent, handler: () => void) => {
    e.stopPropagation()
    handler()
  }

  // Nothing to show if not waiting and not executing
  if (!isWaiting && !isExecuting) return null

  // Executing state - show loading or abort button
  if (isExecuting) {
    if (showAbort && onAbort) {
      return (
        <ActionsContainer $compact={compact} onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="destructive" onClick={(e) => handleClick(e, onAbort)}>
            {t('chat.input.pause')}
          </Button>
        </ActionsContainer>
      )
    }
    return (
      <ActionsContainer $compact={compact} onClick={(e) => e.stopPropagation()}>
        <LoadingIndicator>
          <LoadingIcon />
          {!compact && <span>{t('message.tools.invoking')}</span>}
        </LoadingIndicator>
      </ActionsContainer>
    )
  }

  // Waiting state - show confirm/cancel buttons
  return (
    <ActionsContainer $compact={compact} onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant={compact ? 'ghost' : 'outline'}
        disabled={isSubmitting}
        className="text-destructive hover:text-destructive"
        onClick={(e) => handleClick(e, cancel)}>
        <CircleX size={compact ? 13 : 14} className="lucide-custom" />
        {!compact && t('common.cancel')}
      </Button>

      {autoApprove ? (
        <div className="flex items-center">
          <Button
            size="sm"
            variant="default"
            disabled={isSubmitting}
            className="rounded-r-none"
            onClick={(e) => handleClick(e, confirm)}>
            <CirclePlay size={compact ? 13 : 15} className="lucide-custom" />
            {t('settings.mcp.tools.run', 'Run')}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="default"
                disabled={isSubmitting}
                className="rounded-l-none border-primary-foreground/20 border-l px-1.5"
                onClick={(e) => e.stopPropagation()}>
                <ChevronDown size={compact ? 12 : 14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1">
              <MenuList>
                <MenuItem
                  label={t('settings.mcp.tools.autoApprove.label')}
                  icon={<ShieldCheck size={14} />}
                  onClick={(e) => {
                    e.stopPropagation()
                    void autoApprove()
                  }}
                />
              </MenuList>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <Button size="sm" variant="default" disabled={isSubmitting} onClick={(e) => handleClick(e, confirm)}>
          <CirclePlay size={compact ? 13 : 15} className="lucide-custom" />
          {t('settings.mcp.tools.run', 'Run')}
        </Button>
      )}
    </ActionsContainer>
  )
}

// Styled components

const ActionsContainer = ({
  className,
  $compact,
  ...props
}: ComponentPropsWithoutRef<'div'> & { $compact: boolean }) => (
  <div
    className={[
      'flex items-center',
      $compact
        ? 'gap-1 [&_[data-slot=button]]:h-6 [&_[data-slot=button]]:px-1.5 [&_[data-slot=button]]:py-0 [&_[data-slot=button]]:text-xs'
        : 'gap-2 [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:px-2 [&_[data-slot=button]]:py-0 [&_[data-slot=button]]:text-[13px]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const LoadingIndicator = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex items-center gap-1.5 text-(--color-primary) text-xs', className].filter(Boolean).join(' ')}
    {...props}
  />
)

export default ToolApprovalActionsComponent
