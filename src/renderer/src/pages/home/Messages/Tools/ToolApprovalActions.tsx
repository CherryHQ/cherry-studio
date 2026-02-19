import { LoadingIcon } from '@renderer/components/Icons'
import { Button, Dropdown } from 'antd'
import { ChevronDown, CirclePlay, CircleX, ShieldCheck } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
  remainingSeconds,
  isExpired,
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

  // Expired state for agent tools
  if (isExpired && !isExecuting) {
    return (
      <ExpiredBadge $compact={compact} onClick={(e) => e.stopPropagation()}>
        {t('agent.toolPermission.expired')}
      </ExpiredBadge>
    )
  }

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
          <CountdownText $compact={compact}>
            {compact ? `${remainingSeconds}s` : `${t('settings.mcp.tools.run', 'Run')} (${remainingSeconds}s)`}
          </CountdownText>
        </StyledDropdownButton>
      ) : (
        <Button size="small" type="primary" disabled={isSubmitting} onClick={(e) => handleClick(e, confirm)}>
          <CirclePlay size={compact ? 13 : 15} className="lucide-custom" />
          <CountdownText $compact={compact}>
            {compact ? `${remainingSeconds}s` : `${t('settings.mcp.tools.run', 'Run')} (${remainingSeconds}s)`}
          </CountdownText>
        </Button>
      )}
    </ActionsContainer>
  )
}

// Styled components

const ActionsContainer = styled.div<{ $compact: boolean }>`
  display: flex;
  align-items: center;
  gap: ${(props) => (props.$compact ? '4px' : '8px')};

  .ant-btn-sm {
    height: ${(props) => (props.$compact ? '24px' : '28px')};
    padding: ${(props) => (props.$compact ? '0 6px' : '0 8px')};
    font-size: ${(props) => (props.$compact ? '12px' : '13px')};
  }
`

const ExpiredBadge = styled.span<{ $compact: boolean }>`
  font-size: ${(props) => (props.$compact ? '11px' : '12px')};
  color: var(--color-status-error, #ff4d4f);
  padding: ${(props) => (props.$compact ? '2px 6px' : '4px 8px')};
  background: var(--color-status-error-bg, rgba(255, 77, 79, 0.1));
  border-radius: 4px;
`

const LoadingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary);
  font-size: 12px;
`

const CountdownText = styled.span<{ $compact: boolean }>`
  min-width: ${(props) => (props.$compact ? '24px' : '65px')};
  text-align: left;
`

const StyledDropdownButton = styled(Dropdown.Button)`
  .ant-btn-group {
    border-radius: 6px;
  }
`

export default ToolApprovalActionsComponent
