import { LoadingIcon } from '@renderer/components/Icons'
import type { NormalToolResponse } from '@renderer/types'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type StatusColor, StatusIndicatorContainer, StreamingContext } from './agent/GenericTools'
import { isValidAgentToolsType, renderTool } from './agent/index'
import { UnknownToolRenderer } from './agent/UnknownToolRenderer'
import { useToolApproval } from './hooks/useToolApproval'
import ToolApprovalActionsComponent from './ToolApprovalActions'

interface Props {
  toolResponse: NormalToolResponse
}

export function ToolPermissionRequestCard({ toolResponse }: Props) {
  const { t } = useTranslation()

  const approval = useToolApproval(toolResponse)

  const statusInfo = useMemo((): { color: StatusColor; text: string; showLoading: boolean } => {
    if (approval.isExecuting) {
      return { color: 'primary', text: t('message.tools.invoking'), showLoading: true }
    }
    return {
      color: 'warning',
      text: t('agent.toolPermission.pending'),
      showLoading: true
    }
  }, [approval.isExecuting, t])

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
    <div className="w-full max-w-xl overflow-hidden rounded-xl border border-(--color-border) bg-(--color-background-soft) [&_.ant-collapse-header]:px-3! [&_.ant-collapse-header]:py-2! [&_.ant-collapse-item]:border-none [&_.ant-collapse]:rounded-none [&_.ant-collapse]:border-none [&_.ant-collapse]:bg-transparent">
      {/* Tool content area with status in header */}
      {renderToolContent()}

      {/* Bottom action bar - only show when not invoking */}
      {!approval.isExecuting && (
        <div className="flex items-center justify-end border-(--color-border) border-t bg-(--color-background) px-3 py-2">
          <ToolApprovalActionsComponent {...approval} />
        </div>
      )}
    </div>
  )
}

export default ToolPermissionRequestCard
