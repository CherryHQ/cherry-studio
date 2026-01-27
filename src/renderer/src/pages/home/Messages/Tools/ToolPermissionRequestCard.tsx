import { LoadingIcon } from '@renderer/components/Icons'
import type { NormalToolResponse } from '@renderer/types'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useAgentToolApproval } from './hooks/useAgentToolApproval'
import { type StatusColor, StatusIndicatorContainer, StreamingContext } from './MessageAgentTools/GenericTools'
import { isValidAgentToolsType, renderTool } from './MessageAgentTools/index'
import { UnknownToolRenderer } from './MessageAgentTools/UnknownToolRenderer'
import ToolApprovalActionsComponent from './ToolApprovalActions'

interface Props {
  toolResponse: NormalToolResponse
}

export function ToolPermissionRequestCard({ toolResponse }: Props) {
  const { t } = useTranslation()

  const approval = useAgentToolApproval(null, { toolCallId: toolResponse.toolCallId })

  const statusInfo = useMemo((): { color: StatusColor; text: string; showLoading: boolean } => {
    if (approval.isExecuting) {
      return { color: 'primary', text: t('message.tools.invoking'), showLoading: true }
    }
    if (approval.isExpired) {
      return { color: 'error', text: t('agent.toolPermission.expired'), showLoading: false }
    }
    return {
      color: 'warning',
      text: t('agent.toolPermission.pending', { seconds: approval.remainingSeconds }),
      showLoading: true
    }
  }, [approval.isExecuting, approval.isExpired, approval.remainingSeconds, t])

  const renderToolContent = useCallback((): React.ReactNode => {
    const toolName = toolResponse.tool?.name ?? ''
    const input = (approval.input ?? toolResponse.arguments) as Record<string, unknown> | undefined

    const renderedItem = isValidAgentToolsType(toolName)
      ? renderTool(toolName, input)
      : UnknownToolRenderer({ input, toolName })

    const statusIndicator = (
      <StatusIndicatorContainer $color={statusInfo.color}>
        {statusInfo.text}
        {statusInfo.showLoading && <LoadingIcon />}
      </StatusIndicatorContainer>
    )

    const toolContentItem: NonNullable<CollapseProps['items']>[number] = {
      ...renderedItem,
      label: (
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{renderedItem.label}</div>
          <div className="shrink-0 pt-px">{statusIndicator}</div>
        </div>
      ),
      classNames: {
        body: 'bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100 max-h-60 overflow-auto'
      }
    }

    return (
      <StreamingContext value={false}>
        <Collapse
          className="w-full"
          expandIconPosition="end"
          size="small"
          defaultActiveKey={[String(renderedItem.key ?? toolName)]}
          items={[toolContentItem]}
        />
      </StreamingContext>
    )
  }, [toolResponse.tool?.name, approval.input, toolResponse.arguments, statusInfo])

  return (
    <Container>
      {/* Tool content area with status in header */}
      {renderToolContent()}

      {/* Bottom action bar - only show when not invoking */}
      {!approval.isExecuting && (
        <ActionsBar>
          <ToolApprovalActionsComponent {...approval} />
        </ActionsBar>
      )}

      {approval.isExpired && !approval.isSubmitting && !approval.isExecuting && (
        <div className="px-3 pb-2 text-center text-danger-500 text-xs">
          {t('agent.toolPermission.permissionExpired')}
        </div>
      )}
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  max-width: 36rem;
  border-radius: 0.75rem;
  border: 1px solid var(--color-border);
  background-color: var(--color-background-soft);
  overflow: hidden;

  .ant-collapse {
    border: none;
    border-radius: 0;
    background: transparent;
  }

  .ant-collapse-item {
    border: none;
  }

  .ant-collapse-header {
    padding: 8px 12px !important;
  }
`

const ActionsBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 12px;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-background);
`

export default ToolPermissionRequestCard
