import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import type { ToolRenderItem } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
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
        outcome: 'success' | 'error'
      }
  )

const PROCESS_CONTENT_CLASS_NAME =
  'flex w-full flex-col gap-3 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!'

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
  const [isExpanded, setIsExpanded] = useState(false)
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
  const completedElapsedMs = useMemo(() => {
    if (props.phase === 'active') return undefined
    if (typeof message.stats?.timeCompletionMs === 'number') return message.stats.timeCompletionMs
    if (!message.updatedAt) return undefined

    const startedAt = Date.parse(message.createdAt)
    const finishedAt = Date.parse(message.updatedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return undefined
    return finishedAt - startedAt
  }, [message.createdAt, message.stats?.timeCompletionMs, message.updatedAt, props.phase])

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
  const header = (
    <ToolBlockGroupHeaderContent items={toolItems} elapsedText={elapsedText} summary={summary} preferSummary />
  )

  return (
    <div ref={anchorRef} className={`group/completed-tool-history mb-2 w-full max-w-full ${isExpanded ? 'pb-2' : ''}`}>
      <Accordion
        type="single"
        collapsible
        value={isExpanded ? 'history' : ''}
        onValueChange={(value) => withScrollAnchor(() => setIsExpanded(value === 'history'), { settleAfterMs: 220 })}>
        <AccordionItem value="history" className="border-0 first:border-t-0">
          <AccordionTrigger
            data-testid="completed-process-trigger"
            className="group/tool-group-trigger [&>svg]:-rotate-90 h-auto min-h-7 w-fit max-w-full flex-none select-none justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left font-normal shadow-none hover:no-underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-0 [&>svg]:size-3.5 [&>svg]:opacity-60 [&>svg]:transition-transform [&[data-state=open]>svg]:rotate-0">
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
