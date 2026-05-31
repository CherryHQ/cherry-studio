import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useAppSelector } from '@renderer/store'
import type { ToolPermissionEntry } from '@renderer/store/toolPermissions'
import type { MCPToolResponseStatus } from '@renderer/types'
import type { Message, MessageBlock, ToolMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import { isToolPending } from '@renderer/utils/userConfirmation'
import { Collapse, type CollapseProps } from 'antd'
import { ChevronRight, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useToolApproval } from '../Tools/hooks/useToolApproval'
import { getEffectiveStatus, type ToolStatus } from '../Tools/MessageAgentTools/GenericTools'
import MessageTools from '../Tools/MessageTools'
import ToolApprovalActionsComponent from '../Tools/ToolApprovalActions'
import ToolHeader from '../Tools/ToolHeader'
import BlockErrorFallback from './BlockErrorFallback'
import MainTextBlock from './MainTextBlock'
import ThinkingBlock from './ThinkingBlock'

// ============ Styled Components ============

const Container = styled.div`
  width: 100%;
  max-width: 100%;

  /* Only style the direct group collapse, not nested tool collapses */
  > .ant-collapse {
    background: transparent;
    border: none;
    width: 100%;

    > .ant-collapse-item {
      border: none !important;
      width: 100%;

      > .ant-collapse-header {
        box-sizing: border-box !important;
        height: 38px !important;
        min-height: 38px !important;
        padding: 0 !important;
        background: var(--color-background);
        border: 0.5px solid var(--color-border);
        border-radius: 10px !important;
        display: flex !important;
        align-items: center !important;

        .ant-collapse-expand-icon {
          width: 40px;
          height: 38px !important;
          padding: 0 !important;
          margin-inline-start: 0 !important;
          display: flex !important;
          align-items: center;
          justify-content: center;
        }

        .ant-collapse-header-text {
          height: 38px !important;
          min-width: 0;
          display: flex !important;
          align-items: center !important;
          flex: 1 !important;
        }
      }

      &.tool-group-waiting-approval > .ant-collapse-header {
        padding: 0 !important;
      }

      > .ant-collapse-content {
        border: none;
        background: transparent;
        width: 100%;

        > .ant-collapse-content-box {
          padding: 10px 0 0 0 !important;
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
        }
      }
    }
  }
`

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  height: 38px;
  width: 100%;
  font-size: 13px;
  font-weight: 500;

  .tool-icon {
    color: var(--color-text-2);
    width: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tool-count {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-1);
  }
`

const HeaderSeparator = styled.span`
  width: 1px;
  height: 12px;
  background-color: var(--color-border-soft);
`

const ScrollableToolList = styled.div<{ $allCompleted: boolean }>`
  max-height: ${(props) => (props.$allCompleted ? 'none' : '300px')};
  overflow-y: ${(props) => (props.$allCompleted ? 'visible' : 'auto')};
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
`

const ToolItem = styled.div<{ $isCompleted: boolean }>`
  opacity: ${(props) => (props.$isCompleted ? 0.7 : 1)};
  transition: opacity 0.2s;
  width: 100%;

  .message-thought-container {
    margin-bottom: 0;
  }
`

const AnimatedHeaderWrapper = styled(motion.div)`
  display: block;
  width: 100%;
`

const HeaderWithActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  justify-content: space-between;
`

const ExpandIcon = styled(ChevronRight)<{ $isActive?: boolean }>`
  transition: transform 0.2s;
  transform: ${({ $isActive }) => ($isActive ? 'rotate(90deg)' : 'rotate(0deg)')};
`

// ============ Types & Helpers ============

interface Props {
  blocks: MessageBlock[]
  role?: Message['role']
}

function isCompletedStatus(status: MCPToolResponseStatus | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

// Calculate actual waiting state for a block (not depending on hooks)
function getBlockIsWaiting(block: ToolMessageBlock, agentPermissions: Record<string, ToolPermissionEntry>): boolean {
  const toolResponse = block.metadata?.rawMcpToolResponse
  if (!toolResponse || toolResponse.status !== 'pending') return false

  const tool = toolResponse.tool
  if (tool?.type === 'mcp') {
    // MCP tools: check the global confirmation queue
    return isToolPending(toolResponse.id)
  } else {
    // Agent tools: check Redux store for pending permission
    const permission = Object.values(agentPermissions).find((p) => p.toolCallId === toolResponse.toolCallId)
    return permission?.status === 'pending'
  }
}

// Get effective UI status for a block
function getBlockEffectiveStatus(
  block: ToolMessageBlock,
  agentPermissions: Record<string, ToolPermissionEntry>
): ToolStatus {
  const toolResponse = block.metadata?.rawMcpToolResponse
  const isWaiting = getBlockIsWaiting(block, agentPermissions)
  return getEffectiveStatus(toolResponse?.status, isWaiting)
}

// Animation variants for smooth header transitions
const headerVariants = {
  enter: { x: 20, opacity: 0 },
  center: { x: 0, opacity: 1, transition: { duration: 0.2, ease: 'easeOut' as const } },
  exit: { x: -20, opacity: 0, transition: { duration: 0.15 } }
}

// ============ Sub-Components ============

// Component for rendering a block with approval actions
interface WaitingToolHeaderProps {
  block: ToolMessageBlock
}

const WaitingToolHeader = React.memo(({ block }: WaitingToolHeaderProps) => {
  const approval = useToolApproval(block)
  const toolResponse = block.metadata?.rawMcpToolResponse
  const effectiveStatus = getEffectiveStatus(toolResponse?.status, approval.isWaiting)

  return (
    <HeaderWithActions>
      <ToolHeader block={block} variant="collapse-label" status={effectiveStatus} />
      {(approval.isWaiting || approval.isExecuting) && <ToolApprovalActionsComponent {...approval} compact />}
    </HeaderWithActions>
  )
})
WaitingToolHeader.displayName = 'WaitingToolHeader'

interface GroupHeaderContentProps {
  blocks: MessageBlock[]
  allCompleted: boolean
}

const GroupHeaderContent = React.memo(({ blocks, allCompleted }: GroupHeaderContentProps) => {
  const { t } = useTranslation()
  const agentPermissions = useAppSelector((state) => state.toolPermissions.requests)
  const toolBlocks = blocks.filter((block): block is ToolMessageBlock => block.type === MessageBlockType.TOOL)
  const thinkingBlockCount = blocks.filter((block) => block.type === MessageBlockType.THINKING).length
  const messageBlockCount = blocks.filter((block) => block.type === MessageBlockType.MAIN_TEXT).length
  const groupHeaderParts = [
    toolBlocks.length > 0 ? t('message.tools.groupHeader', { count: toolBlocks.length }) : null,
    thinkingBlockCount > 0 ? t('message.tools.groupHeaderThinking', { count: thinkingBlockCount }) : null,
    messageBlockCount > 0 ? t('message.tools.groupHeaderMessages', { count: messageBlockCount }) : null
  ].filter(Boolean)
  const groupHeader = (
    <>
      {groupHeaderParts.map((part, index) => (
        <React.Fragment key={part}>
          {index > 0 && <HeaderSeparator />}
          <span>{part}</span>
        </React.Fragment>
      ))}
    </>
  )

  if (allCompleted) {
    return (
      <GroupHeader>
        <Wrench size={14} className="tool-icon" />
        <span className="tool-count">{groupHeader}</span>
      </GroupHeader>
    )
  }

  // Find blocks actually waiting for approval (using effective status)
  const waitingBlocks = toolBlocks.filter((block) => getBlockEffectiveStatus(block, agentPermissions) === 'waiting')

  // Prioritize showing waiting blocks that need approval
  const lastWaitingBlock = waitingBlocks[waitingBlocks.length - 1]
  if (lastWaitingBlock) {
    return (
      <AnimatePresence mode="wait">
        <AnimatedHeaderWrapper
          key={lastWaitingBlock.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <WaitingToolHeader block={lastWaitingBlock} />
        </AnimatedHeaderWrapper>
      </AnimatePresence>
    )
  }

  // Find running blocks (invoking or streaming)
  const runningBlocks = toolBlocks.filter((block) => {
    const status = getBlockEffectiveStatus(block, agentPermissions)
    return status === 'invoking' || status === 'streaming'
  })

  // Get the last running block (most recent) and render with animation
  const lastRunningBlock = runningBlocks[runningBlocks.length - 1]
  if (lastRunningBlock) {
    return (
      <AnimatePresence mode="wait">
        <AnimatedHeaderWrapper
          key={lastRunningBlock.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <ToolHeader block={lastRunningBlock} variant="collapse-label" />
        </AnimatedHeaderWrapper>
      </AnimatePresence>
    )
  }

  // Fallback
  return (
    <GroupHeader>
      <Wrench size={14} className="tool-icon" />
      <span className="tool-count">{groupHeader}</span>
    </GroupHeader>
  )
})
GroupHeaderContent.displayName = 'GroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolListContentProps {
  blocks: MessageBlock[]
  allCompleted: boolean
  role: Message['role']
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const ToolListContent = React.memo(({ blocks, allCompleted, role, scrollRef }: ToolListContentProps) => (
  <ScrollableToolList ref={scrollRef} $allCompleted={allCompleted}>
    {blocks.map((block) => {
      if (block.type === MessageBlockType.THINKING) {
        return (
          <ToolItem key={block.id} data-block-id={block.id} $isCompleted>
            <ErrorBoundary fallbackComponent={BlockErrorFallback}>
              <ThinkingBlock block={block} />
            </ErrorBoundary>
          </ToolItem>
        )
      }

      if (block.type === MessageBlockType.MAIN_TEXT) {
        const citationBlockId = block.citationReferences?.[0]?.citationBlockId

        return (
          <ToolItem key={block.id} data-block-id={block.id} $isCompleted>
            <ErrorBoundary fallbackComponent={BlockErrorFallback}>
              <MainTextBlock block={block} citationBlockId={citationBlockId} role={role} />
            </ErrorBoundary>
          </ToolItem>
        )
      }

      if (block.type !== MessageBlockType.TOOL) {
        return null
      }

      const status = block.metadata?.rawMcpToolResponse?.status
      const isCompleted = isCompletedStatus(status)
      return (
        <ToolItem key={block.id} data-block-id={block.id} $isCompleted={isCompleted}>
          <ErrorBoundary fallbackComponent={BlockErrorFallback}>
            <MessageTools block={block} />
          </ErrorBoundary>
        </ToolItem>
      )
    })}
  </ScrollableToolList>
))
ToolListContent.displayName = 'ToolListContent'

// ============ Main Component ============

const ToolBlockGroup: React.FC<Props> = ({ blocks, role = 'assistant' }) => {
  const [activeKey, setActiveKey] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const agentPermissions = useAppSelector((state) => state.toolPermissions.requests)
  const toolBlocks = useMemo(
    () => blocks.filter((block): block is ToolMessageBlock => block.type === MessageBlockType.TOOL),
    [blocks]
  )

  const allCompleted = useMemo(() => {
    return toolBlocks.every((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return isCompletedStatus(status)
    })
  }, [toolBlocks])

  const currentRunningBlock = useMemo(() => {
    return toolBlocks.find((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return !isCompletedStatus(status)
    })
  }, [toolBlocks])

  const hasWaitingTool = useMemo(() => {
    return toolBlocks.some((block) => getBlockEffectiveStatus(block, agentPermissions) === 'waiting')
  }, [toolBlocks, agentPermissions])

  useEffect(() => {
    if (activeKey.includes('tool-group') && currentRunningBlock && scrollRef.current) {
      const element = scrollRef.current.querySelector(`[data-block-id="${currentRunningBlock.id}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeKey, currentRunningBlock])

  const handleChange = (keys: string | string[]) => {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    setActiveKey(keyArray)
  }

  const items: CollapseProps['items'] = useMemo(() => {
    return [
      {
        key: 'tool-group',
        className: hasWaitingTool ? 'tool-group-waiting-approval' : undefined,
        label: <GroupHeaderContent blocks={blocks} allCompleted={allCompleted} />,
        children: <ToolListContent blocks={blocks} allCompleted={allCompleted} role={role} scrollRef={scrollRef} />
      }
    ]
  }, [blocks, allCompleted, hasWaitingTool, role])

  return (
    <Container>
      <Collapse
        ghost
        size="small"
        expandIconPosition="end"
        activeKey={activeKey}
        onChange={handleChange}
        items={items}
        expandIcon={({ isActive }) => (
          <ExpandIcon $isActive={isActive} size={18} color="var(--color-text-3)" strokeWidth={1.5} />
        )}
      />
    </Container>
  )
}

export default React.memo(ToolBlockGroup)
