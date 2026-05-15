import { LoadingIcon } from '@renderer/components/Icons'
import type { NormalToolResponse } from '@renderer/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type StatusColor, StatusIndicatorContainer, StreamingContext } from './agent/GenericTools'
import { isValidAgentToolsType, renderTool } from './agent/toolRendererRegistry'
import { UnknownToolRenderer } from './agent/UnknownToolRenderer'
import { useToolApproval } from './hooks/useToolApproval'
import { ToolDisclosure, type ToolDisclosureItem } from './shared/ToolDisclosure'
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

    const toolContentItem: ToolDisclosureItem = {
      ...renderedItem,
      label: (
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{renderedItem.label}</div>
          <div className="shrink-0 pt-px">{statusIndicator}</div>
        </div>
      ),
      classNames: {
        body: 'max-h-60 overflow-auto bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100'
      }
    }

    return (
      <StreamingContext value={false}>
        <ToolDisclosure
          className="w-full"
          defaultActiveKey={[String(renderedItem.key ?? toolName)]}
          items={[toolContentItem]}
        />
      </StreamingContext>
    )
  }, [toolResponse.tool?.name, approval.input, toolResponse.arguments, statusInfo])

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-muted">
      {/* Tool content area with status in header */}
      {renderToolContent()}

      {/* Bottom action bar - only show when not invoking */}
      {!approval.isExecuting && (
        <div className="flex items-center justify-end border-border border-t bg-background px-3 py-2">
          <ToolApprovalActionsComponent {...approval} />
        </div>
      )}
    </div>
  )
}

export default ToolPermissionRequestCard
