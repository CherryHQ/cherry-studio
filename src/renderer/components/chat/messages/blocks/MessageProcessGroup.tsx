import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import type { ToolRenderItem } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { MessageRuntimeTiming } from '@shared/data/types/message'

import { useMessageDisclosureState } from '../hooks/useMessageDisclosureState'
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

const LazyCompletedProcessContent = React.memo(function LazyCompletedProcessContent({
  render
}: {
  render: (isExpanded: boolean) => React.ReactNode
}) {
  return <>{render(true)}</>
})

const ActiveProcessHeader = React.memo(function ActiveProcessHeader({
  createdAt,
  startedAtMs,
  toolItems
}: {
  createdAt: string
  startedAtMs?: number
  toolItems: ToolRenderItem[]
}) {
  const { t } = useTranslation()
  const effectiveCreatedAt = useMemo(() => {
    if (startedAtMs !== undefined && Number.isFinite(startedAtMs)) {
      return new Date(startedAtMs).toISOString()
    }
    return createdAt
  }, [createdAt, startedAtMs])
  const elapsedMs = usePlaceholderElapsedMs(true, effectiveCreatedAt, 1000)
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
          className="flex min-h-7 w-full items-center py-0.5 text-left select-none">
          <div className="min-w-0 flex-1 overflow-hidden">
            <ActiveProcessHeader
              createdAt={message.createdAt}
              startedAtMs={runtimeTiming?.startedAt}
              toolItems={toolItems}
            />
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
  const header = (
    <ToolBlockGroupHeaderContent items={toolItems} elapsedText={elapsedText} summary={summary} preferSummary />
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
          <AccordionTrigger
            data-testid="completed-process-trigger"
            className="group/tool-group-trigger h-auto min-h-7 w-fit max-w-full flex-none justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left font-normal shadow-none select-none hover:no-underline focus-visible:bg-accent/50 focus-visible:outline-none [&>svg]:size-3.5 [&>svg]:-rotate-90 [&>svg]:opacity-60 [&>svg]:transition-transform [&[data-state=open]>svg]:rotate-0">
            <div className="min-w-0 overflow-hidden">{header}</div>
          </AccordionTrigger>
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
