import type { MCPTool, MCPToolResponseStatus } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { Collapse, type CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { type ToolStatus, ToolStatusIndicator } from '../Tools/MessageAgentTools/GenericTools'
import MessageTools from '../Tools/MessageTools'

// ============ Styled Components ============

const Container = styled.div`
  width: 100%;
  max-width: 36rem;

  /* Only style the direct group collapse, not nested tool collapses */
  > .ant-collapse {
    background: transparent;
    border: none;

    > .ant-collapse-item {
      border: none !important;

      > .ant-collapse-header {
        padding: 8px 12px !important;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem !important;
      }

      > .ant-collapse-content {
        border: none;
        background: transparent;

        > .ant-collapse-content-box {
          padding: 4px 0 0 0 !important;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
      }
    }
  }
`

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;

  .tool-icon {
    color: var(--color-primary);
  }

  .tool-count {
    color: var(--color-text-1);
  }

  .tool-name {
    color: var(--color-text-1);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const ScrollableToolList = styled.div`
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ToolItem = styled.div<{ $isCompleted: boolean }>`
  opacity: ${(props) => (props.$isCompleted ? 0.7 : 1)};
  transition: opacity 0.2s;
`

// ============ Types & Helpers ============

interface Props {
  blocks: ToolMessageBlock[]
}

const isCompletedStatus = (status: MCPToolResponseStatus | undefined): boolean => {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

// Get tool display name
const getToolDisplayName = (tool: any): string => {
  if (tool?.type === 'mcp') {
    const mcpTool = tool as MCPTool
    return `${mcpTool.serverName} : ${mcpTool.name}`
  }
  return tool?.name ?? 'Tool'
}

// ============ Sub-Components ============

interface GroupHeaderContentProps {
  blocks: ToolMessageBlock[]
  allCompleted: boolean
}

const GroupHeaderContent = React.memo(({ blocks, allCompleted }: GroupHeaderContentProps) => {
  const { t } = useTranslation()

  if (allCompleted) {
    return (
      <GroupHeader>
        <Wrench size={14} className="tool-icon" />
        <span className="tool-count">{t('message.tools.groupHeader', { count: blocks.length })}</span>
      </GroupHeader>
    )
  }

  // Find running tools
  const runningBlocks = blocks.filter((block) => {
    const status = block.metadata?.rawMcpToolResponse?.status
    return !isCompletedStatus(status)
  })

  // Multiple running tools
  if (runningBlocks.length > 1) {
    return (
      <GroupHeader>
        <Wrench size={14} className="tool-icon" />
        <span className="tool-count">{t('message.tools.runningCount', { count: runningBlocks.length })}</span>
        <ToolStatusIndicator status="invoking" />
      </GroupHeader>
    )
  }

  // Single running tool
  const currentBlock = runningBlocks[0]
  if (currentBlock) {
    const toolResponse = currentBlock.metadata?.rawMcpToolResponse
    const tool = toolResponse?.tool
    const status = toolResponse?.status

    return (
      <GroupHeader>
        <Wrench size={14} className="tool-icon" />
        <span className="tool-name">{getToolDisplayName(tool)}</span>
        {status && <ToolStatusIndicator status={status as ToolStatus} />}
      </GroupHeader>
    )
  }

  // Fallback
  return (
    <GroupHeader>
      <Wrench size={14} className="tool-icon" />
      <span className="tool-count">{t('message.tools.groupHeader', { count: blocks.length })}</span>
    </GroupHeader>
  )
})
GroupHeaderContent.displayName = 'GroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolListContentProps {
  blocks: ToolMessageBlock[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const ToolListContent = React.memo(({ blocks, scrollRef }: ToolListContentProps) => (
  <ScrollableToolList ref={scrollRef}>
    {blocks.map((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      const isCompleted = isCompletedStatus(status)
      return (
        <ToolItem key={block.id} data-block-id={block.id} $isCompleted={isCompleted}>
          <MessageTools block={block} />
        </ToolItem>
      )
    })}
  </ScrollableToolList>
))
ToolListContent.displayName = 'ToolListContent'

// ============ Main Component ============

const ToolBlockGroup: React.FC<Props> = ({ blocks }) => {
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Calculate if all tools are completed
  const allCompleted = useMemo(() => {
    return blocks.every((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return isCompletedStatus(status)
    })
  }, [blocks])

  // Find first running block for auto-scroll
  const currentRunningBlock = useMemo(() => {
    return blocks.find((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return !isCompletedStatus(status)
    })
  }, [blocks])

  // Auto-scroll to running tool
  useEffect(() => {
    if (expanded && currentRunningBlock && scrollRef.current) {
      const element = scrollRef.current.querySelector(`[data-block-id="${currentRunningBlock.id}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [expanded, currentRunningBlock])

  const items: CollapseProps['items'] = useMemo(() => {
    return [
      {
        key: 'tool-group',
        label: <GroupHeaderContent blocks={blocks} allCompleted={allCompleted} />,
        children: <ToolListContent blocks={blocks} scrollRef={scrollRef} />
      }
    ]
  }, [blocks, allCompleted])

  return (
    <Container>
      <Collapse
        ghost
        size="small"
        expandIconPosition="end"
        activeKey={expanded ? ['tool-group'] : []}
        onChange={(keys) => setExpanded(keys.includes('tool-group'))}
        items={items}
      />
    </Container>
  )
}

export default React.memo(ToolBlockGroup)
