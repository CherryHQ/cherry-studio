import { LoadingIcon } from '@renderer/components/Icons'
import type { NormalToolResponse } from '@renderer/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useToolApproval } from '../hooks/useToolApproval'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import ToolApprovalActionsComponent from '../ToolApprovalActions'
import { AgentToolDisclosure, AgentToolDisclosureLabel } from './AgentToolDisclosure'
import { type StatusColor, StatusIndicatorContainer } from './GenericTools'
import { isValidAgentToolsType, renderTool } from './toolRendererRegistry'
import { UnknownToolRenderer } from './UnknownToolRenderer'

interface Props {
  toolResponse: NormalToolResponse
}

export function ToolPermissionCard({ toolResponse }: Props) {
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
      <AgentToolDisclosureLabel
        label={renderedItem.label}
        labelClassName="min-w-0 flex-1"
        trailing={statusIndicator}
        trailingClassName="shrink-0 pt-px"
      />
    ),
    classNames: {
      body: 'max-h-60 overflow-auto bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100'
    }
  }

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-muted">
      <AgentToolDisclosure
        className="w-full"
        defaultActiveKey={[String(renderedItem.key ?? toolName)]}
        item={toolContentItem}
      />

      {!approval.isExecuting && (
        <div className="flex items-center justify-end border-border border-t bg-background px-3 py-2">
          <ToolApprovalActionsComponent {...approval} />
        </div>
      )}
    </div>
  )
}

export default ToolPermissionCard
