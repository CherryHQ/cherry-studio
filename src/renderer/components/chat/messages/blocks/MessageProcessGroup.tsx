import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import type { ToolRenderItem } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { Brain, MessageSquareText } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
        contentKind: 'tools' | 'reasoning' | 'other'
        outcome: 'success' | 'error'
      }
  )

const PROCESS_CONTENT_CLASS_NAME =
  'flex w-full flex-col gap-2 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!'

const LazyCompletedProcessContent = React.memo(function LazyCompletedProcessContent({
  render
}: {
  render: (isExpanded: boolean) => React.ReactNode
}) {
  return <>{render(true)}</>
})

/** The top-level process group across both active and completed message phases. */
const MessageProcessGroup = React.memo(function MessageProcessGroup(props: Props) {
  const { children, message, toolItems } = props
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
  const liveElapsedMs = usePlaceholderElapsedMs(props.phase === 'active', message.createdAt)
  const completedElapsedMs = useMemo(() => {
    if (props.phase === 'active') return undefined
    if (typeof message.stats?.timeCompletionMs === 'number') return message.stats.timeCompletionMs
    if (!message.updatedAt) return undefined

    const startedAt = Date.parse(message.createdAt)
    const finishedAt = Date.parse(message.updatedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return undefined
    return finishedAt - startedAt
  }, [message.createdAt, message.stats?.timeCompletionMs, message.updatedAt, props.phase])
  const elapsedMs = props.phase === 'active' ? liveElapsedMs : completedElapsedMs
  const elapsedText = elapsedMs === undefined ? undefined : formatPlaceholderElapsed(elapsedMs, t)
  const processingSummary = t('message.processing').replace(/(?:\.{3}|…)\s*$/u, '')
  const summary =
    props.phase === 'active'
      ? processingSummary
      : props.outcome === 'error'
        ? t('message.tools.error')
        : props.contentKind === 'reasoning'
          ? t('common.reasoning_content')
          : t('message.tools.processed')
  const header = (
    <ToolBlockGroupHeaderContent
      items={toolItems}
      elapsedText={elapsedText}
      summary={summary}
      preferSummary
      showContentIcon={props.phase === 'completed'}
      summaryIcon={
        props.phase === 'completed' && props.contentKind === 'reasoning' ? (
          <Brain aria-hidden="true" className="size-3.5" />
        ) : props.phase === 'completed' && props.contentKind === 'other' ? (
          <MessageSquareText aria-hidden="true" className="size-3.5" />
        ) : undefined
      }
    />
  )

  if (props.phase === 'active') {
    return (
      <div className="group/live-tool-group mb-2 w-full max-w-full" data-testid="live-tool-group">
        <div data-testid="live-tool-group-header" className="flex min-h-7 w-full items-center py-0.5 text-left">
          <div className="min-w-0 flex-1 overflow-hidden">{header}</div>
        </div>
        <div aria-hidden="true" className="my-1.5 h-px w-full bg-border-subtle" />
        <div data-testid="live-tool-group-content" className={PROCESS_CONTENT_CLASS_NAME}>
          {children(true)}
        </div>
      </div>
    )
  }

  return (
    <div ref={anchorRef} className="group/completed-tool-history mb-2 w-full max-w-full">
      <Accordion
        type="single"
        collapsible
        value={isExpanded ? 'history' : ''}
        onValueChange={(value) => withScrollAnchor(() => setIsExpanded(value === 'history'), { settleAfterMs: 220 })}>
        <AccordionItem value="history" className="border-0 first:border-t-0">
          <AccordionTrigger
            data-testid="completed-process-trigger"
            className="group/tool-group-trigger h-auto min-h-7 w-fit max-w-full flex-none justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left font-normal shadow-none hover:no-underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-0 [&>svg]:size-3.5 [&>svg]:opacity-0 [&>svg]:transition-[transform,opacity] hover:[&>svg]:opacity-60 focus-visible:[&>svg]:opacity-60 [&[data-state=open]>svg]:opacity-60">
            <div className="min-w-0 overflow-hidden">{header}</div>
          </AccordionTrigger>
          <div aria-hidden="true" data-testid="tool-history-divider" className="my-1.5 h-px w-full bg-border-subtle" />
          <AccordionContent
            data-testid="tool-history-content"
            className={`${PROCESS_CONTENT_CLASS_NAME} p-0 text-inherit`}
            contentClassName="text-inherit motion-safe:data-[state=open]:[animation-duration:200ms] motion-safe:data-[state=closed]:[animation-duration:160ms] motion-reduce:animate-none">
            <LazyCompletedProcessContent render={children} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
})

export default MessageProcessGroup
