import { LoadingIcon } from '@renderer/components/Icons'
import { Button, Dropdown } from 'antd'
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
          <Button size="small" color="danger" variant="solid" onClick={(e) => handleClick(e, onAbort)}>
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
        size="small"
        color="danger"
        variant={compact ? 'text' : 'outlined'}
        disabled={isSubmitting}
        onClick={(e) => handleClick(e, cancel)}>
        <CircleX size={compact ? 13 : 14} className="lucide-custom" />
        {!compact && t('common.cancel')}
      </Button>

      {autoApprove ? (
        <StyledDropdownButton
          size="small"
          type="primary"
          disabled={isSubmitting}
          icon={<ChevronDown size={compact ? 12 : 14} />}
          onClick={(e) => handleClick(e, confirm)}
          menu={{
            items: [
              {
                key: 'autoApprove',
                label: t('settings.mcp.tools.autoApprove.label'),
                icon: <ShieldCheck size={14} />,
                onClick: () => autoApprove()
              }
            ]
          }}>
          <CirclePlay size={compact ? 13 : 15} className="lucide-custom" />
          {t('settings.mcp.tools.run', 'Run')}
        </StyledDropdownButton>
      ) : (
        <Button size="small" type="primary" disabled={isSubmitting} onClick={(e) => handleClick(e, confirm)}>
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
        ? 'gap-1 [&_.ant-btn-sm]:h-6 [&_.ant-btn-sm]:px-1.5 [&_.ant-btn-sm]:py-0 [&_.ant-btn-sm]:text-xs'
        : 'gap-2 [&_.ant-btn-sm]:h-7 [&_.ant-btn-sm]:px-2 [&_.ant-btn-sm]:py-0 [&_.ant-btn-sm]:text-[13px]',
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

const StyledDropdownButton = ({ className, ...props }: ComponentPropsWithoutRef<typeof Dropdown.Button>) => (
  <Dropdown.Button className={['[&_.ant-btn-group]:rounded-md', className].filter(Boolean).join(' ')} {...props} />
)

export default ToolApprovalActionsComponent
