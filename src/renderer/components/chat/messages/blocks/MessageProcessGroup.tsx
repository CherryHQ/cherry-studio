import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Tooltip } from '@cherrystudio/ui'
import type { ToolRenderItem } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import type { MessageRuntimeTiming } from '@shared/data/types/message'
import { ArrowUpRight } from 'lucide-react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageDisclosureState } from '../hooks/useMessageDisclosureState'
import { useOptionalMessageListActions } from '../MessageListProvider'
import { parseSessionCreateResult, parseSessionSendResult } from '../tools/agent'
import { formatPlaceholderElapsed, usePlaceholderElapsedMs } from './PlaceholderBlock'
import { ToolBlockGroupHeaderContent } from './ToolBlockGroup'
import { useScrollAnchor } from './useScrollAnchor'

interface BaseProps {
  children: (isExpanded: boolean) => React.ReactNode
  message: MessageListItem
  toolItems: ToolRenderItem[]
}

type Props = BaseProps &
  (
    | { phase: 'active' }
    | {
        phase: 'completed'
        outcome: 'success' | 'error'
      }
  )

const PROCESS_CONTENT_CLASS_NAME =
  'flex w-full flex-col gap-3 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!'

function getApprovalWaitDurationMs(runtimeTiming: MessageRuntimeTiming): number {
  const completedAt = runtimeTiming.completedAt
  if (completedAt === undefined) return 0
  const intervals = runtimeTiming.spans
    .filter((span) => span.kind === 'approval-wait')
    .map((span) => ({
      startedAt: Math.max(runtimeTiming.startedAt, span.startedAt),
      completedAt: Math.min(completedAt, span.completedAt ?? completedAt)
    }))
    .filter((span) => span.completedAt > span.startedAt)
    .sort((left, right) => left.startedAt - right.startedAt)

  let durationMs = 0
  let mergedStart: number | undefined
  let mergedEnd: number | undefined
  for (const interval of intervals) {
    if (mergedStart === undefined || mergedEnd === undefined) {
      mergedStart = interval.startedAt
      mergedEnd = interval.completedAt
    } else if (interval.startedAt <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, interval.completedAt)
    } else {
      durationMs += mergedEnd - mergedStart
      mergedStart = interval.startedAt
      mergedEnd = interval.completedAt
    }
  }
  if (mergedStart !== undefined && mergedEnd !== undefined) durationMs += mergedEnd - mergedStart
  return durationMs
}

function isSessionTransferTool(item: ToolRenderItem): boolean {
  const toolName = item.toolResponse.tool.name
  return (
    toolName === SESSION_CREATE_TOOL_NAME ||
    toolName === SESSION_SEND_TOOL_NAME ||
    toolName.endsWith(`__${SESSION_CREATE_TOOL_NAME}`) ||
    toolName.endsWith(`__${SESSION_SEND_TOOL_NAME}`)
  )
}

function getSessionNavigationTarget(item: ToolRenderItem): { id: string; name: string } | undefined {
  const toolName = item.toolResponse.tool.name
  const args = item.toolResponse.arguments
  const title =
    typeof args === 'object' && args !== null && !Array.isArray(args) && typeof args.title === 'string'
      ? args.title.trim()
      : ''

  if (toolName === SESSION_CREATE_TOOL_NAME || toolName.endsWith(`__${SESSION_CREATE_TOOL_NAME}`)) {
    const result = parseSessionCreateResult(item.toolResponse.response)
    return result ? { id: result.sessionId, name: title || result.sessionId } : undefined
  }

  const result = parseSessionSendResult(item.toolResponse.response)
  const sessionId = result?.delivery?.receiver?.sessionId
  if (!sessionId) return undefined
  return {
    id: sessionId,
    name: result.delivery?.receiverSnapshot?.sessionName?.trim() || sessionId
  }
}

const SessionOpenButton = React.memo(function SessionOpenButton({ target }: { target: { id: string; name: string } }) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  if (!actions?.navigateToRoute) return null

  const openLabel = t('message.tools.sessionCreate.open')
  return (
    <Tooltip content={target.name}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-link text-xs hover:text-link"
        aria-label={`${openLabel}: ${target.name}`}
        onClick={() => void actions.navigateToRoute?.({ path: '/app/agents', query: { sessionId: target.id } })}>
        {openLabel}
        <ArrowUpRight aria-hidden="true" size={13} />
      </Button>
    </Tooltip>
  )
})

const LazyCompletedProcessContent = React.memo(function LazyCompletedProcessContent({
  render
}: {
  render: (isExpanded: boolean) => React.ReactNode
}) {
  return <>{render(true)}</>
})

const ActiveProcessHeader = React.memo(function ActiveProcessHeader({
  createdAt,
  toolItems
}: {
  createdAt: string
  toolItems: ToolRenderItem[]
}) {
  const { t } = useTranslation()
  const elapsedMs = usePlaceholderElapsedMs(true, createdAt, 1000)
  const elapsedText = formatPlaceholderElapsed(elapsedMs, t)
  const summary = t('message.processing').replace(/(?:\.{3}|…)\s*$/u, '')

  return <ToolBlockGroupHeaderContent items={toolItems} elapsedText={elapsedText} summary={summary} preferSummary />
})

/** The top-level process group across both active and completed message phases. */
const MessageProcessGroup = React.memo(function MessageProcessGroup(props: Props) {
  const { children, message, toolItems } = props
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useMessageDisclosureState('completed-process')
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
  const runtimeTiming = message.stats?.runtimeTiming
  const completedElapsedMs = useMemo(() => {
    if (props.phase === 'active') return undefined
    if (runtimeTiming?.completedAt !== undefined) {
      const wallClockMs = Math.max(0, runtimeTiming.completedAt - runtimeTiming.startedAt)
      return Math.max(0, wallClockMs - getApprovalWaitDurationMs(runtimeTiming))
    }
    if (typeof message.stats?.timeCompletionMs === 'number') return message.stats.timeCompletionMs
    if (!message.updatedAt) return undefined

    const startedAt = Date.parse(message.createdAt)
    const finishedAt = Date.parse(message.updatedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return undefined
    return finishedAt - startedAt
  }, [message.createdAt, message.stats?.timeCompletionMs, message.updatedAt, props.phase, runtimeTiming])

  if (props.phase === 'active') {
    return (
      <div className="group/live-tool-group mb-2 w-full max-w-full pb-2" data-testid="live-tool-group">
        <div
          data-testid="live-tool-group-header"
          className="flex min-h-7 w-full select-none items-center py-0.5 text-left">
          <div className="min-w-0 flex-1 overflow-hidden">
            <ActiveProcessHeader createdAt={message.createdAt} toolItems={toolItems} />
          </div>
        </div>
        <div data-testid="live-tool-group-content" className={`${PROCESS_CONTENT_CLASS_NAME} pt-2`}>
          {children(true)}
        </div>
      </div>
    )
  }

  const elapsedText = completedElapsedMs === undefined ? undefined : formatPlaceholderElapsed(completedElapsedMs, t)
  const summary = props.outcome === 'error' ? t('message.tools.error') : t('message.tools.processed')
  const sessionTransferItem = toolItems.findLast(isSessionTransferTool)
  const sessionTarget = sessionTransferItem ? getSessionNavigationTarget(sessionTransferItem) : undefined
  const header = (
    <ToolBlockGroupHeaderContent
      items={sessionTransferItem ? [sessionTransferItem] : toolItems}
      elapsedText={elapsedText}
      summary={summary}
      preferSummary={!sessionTransferItem}
      semanticToolTitle={!!sessionTransferItem}
      showContentIcon={!!sessionTransferItem}
      showLatestWhenComplete={!!sessionTransferItem}
    />
  )

  return (
    <div ref={anchorRef} className={`group/completed-tool-history mb-2 w-full max-w-full ${isExpanded ? 'pb-2' : ''}`}>
      <Accordion
        type="single"
        collapsible
        value={isExpanded ? 'history' : ''}
        onValueChange={(value) =>
          withScrollAnchor(() => setIsExpanded(value === 'history'), {
            enterReadingMode: value === 'history',
            settleAfterMs: 220
          })
        }>
        <AccordionItem value="history" className="border-0 first:border-t-0">
          <div className="flex w-fit max-w-full items-center gap-1">
            <AccordionTrigger
              data-testid="completed-process-trigger"
              className="group/tool-group-trigger [&>svg]:-rotate-90 h-auto min-h-7 min-w-0 max-w-full flex-[0_1_auto] select-none justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left font-normal shadow-none hover:no-underline focus-visible:bg-accent/50 focus-visible:outline-none [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:opacity-60 [&>svg]:transition-transform [&[data-state=open]>svg]:rotate-0">
              <div className="min-w-0 overflow-hidden">{header}</div>
            </AccordionTrigger>
            {sessionTarget ? <SessionOpenButton target={sessionTarget} /> : null}
          </div>
          <AccordionContent
            data-testid="tool-history-content"
            className={`${PROCESS_CONTENT_CLASS_NAME} px-0 pt-2 pb-0 text-inherit`}
            contentClassName="text-inherit motion-safe:data-[state=open]:[animation-duration:200ms] motion-safe:data-[state=closed]:[animation-duration:160ms] motion-reduce:animate-none">
            <LazyCompletedProcessContent render={children} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
})

export default MessageProcessGroup
