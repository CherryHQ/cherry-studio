import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { CherryMessagePart } from '@shared/data/types/message'
import React from 'react'
import { useTranslation } from 'react-i18next'

import MessageTools from '../tools/MessageTools'
import { getEffectiveStatus, type ToolStatus } from '../tools/shared/GenericTools'
import ToolHeader from '../tools/ToolHeader'
import { isToolPartAwaitingApproval, type ToolRenderItem, type ToolResponseLike } from '../tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'
import { usePartsMap } from './MessagePartsContext'
import { PlaceholderShimmerText } from './PlaceholderShimmerText'
import { useScrollAnchor } from './useScrollAnchor'

// ============ Types & Helpers ============

function isToolGroupItemCompleted(status: ToolResponseLike['status'] | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

// Calculate actual waiting state for a tool item (not depending on hooks).
// AI-SDK-v6 ToolUIPart state (`approval-requested`) is the sole source of truth.
function getItemIsWaiting(item: ToolRenderItem, partsMap: Record<string, CherryMessagePart[]> | null): boolean {
  if (item.toolResponse.status !== 'pending') return false
  return isToolPartAwaitingApproval(partsMap, item.toolResponse.toolCallId)
}

// Get effective UI status for an item
function getItemEffectiveStatus(
  item: ToolRenderItem,
  partsMap: Record<string, CherryMessagePart[]> | null
): ToolStatus {
  const isWaiting = getItemIsWaiting(item, partsMap)
  return getEffectiveStatus(item.toolResponse?.status, isWaiting)
}

// ============ Sub-Components ============

const LIVE_HEADER_MIN_DURATION_MS = 700

type ToolHeaderCandidate =
  | { key: string; kind: 'summary'; label: React.ReactNode }
  | { key: string; kind: 'activity'; label: React.ReactNode }
  | { key: string; kind: 'tool'; item: ToolRenderItem; status: ToolStatus }

function getActivityCandidateKey(label: React.ReactNode): string {
  return typeof label === 'string' || typeof label === 'number' ? `activity:${label}` : 'activity'
}

function isErrorHeaderCandidate(candidate: ToolHeaderCandidate): boolean {
  return (
    candidate.kind === 'tool' &&
    (candidate.status === 'error' || candidate.item.toolResponse.response?.isError === true)
  )
}

function shouldBypassHeaderStabilization(
  currentCandidate: ToolHeaderCandidate,
  nextCandidate: ToolHeaderCandidate
): boolean {
  return (
    (nextCandidate.kind === 'tool' && nextCandidate.status === 'waiting') ||
    isErrorHeaderCandidate(nextCandidate) ||
    isErrorHeaderCandidate(currentCandidate)
  )
}

function useStableHeaderCandidate(
  nextCandidate: ToolHeaderCandidate,
  isLiveProgress: boolean | undefined
): ToolHeaderCandidate {
  const [displayCandidate, setDisplayCandidate] = React.useState(nextCandidate)
  const displayCandidateRef = React.useRef(nextCandidate)
  const lastChangeAtRef = React.useRef(Date.now())
  const pendingCandidateRef = React.useRef<ToolHeaderCandidate | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    const clearPendingTimer = () => {
      if (!timerRef.current) return
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const commitCandidate = (candidate: ToolHeaderCandidate) => {
      displayCandidateRef.current = candidate
      lastChangeAtRef.current = Date.now()
      setDisplayCandidate(candidate)
    }

    if (displayCandidateRef.current.key === nextCandidate.key) {
      clearPendingTimer()
      pendingCandidateRef.current = null
      displayCandidateRef.current = nextCandidate
      return clearPendingTimer
    }

    if (!isLiveProgress || shouldBypassHeaderStabilization(displayCandidateRef.current, nextCandidate)) {
      clearPendingTimer()
      pendingCandidateRef.current = null
      commitCandidate(nextCandidate)
      return clearPendingTimer
    }

    pendingCandidateRef.current = nextCandidate
    const elapsedMs = Date.now() - lastChangeAtRef.current
    const remainingMs = Math.max(0, LIVE_HEADER_MIN_DURATION_MS - elapsedMs)

    clearPendingTimer()
    timerRef.current = setTimeout(() => {
      const pendingCandidate = pendingCandidateRef.current
      if (!pendingCandidate) return
      pendingCandidateRef.current = null
      timerRef.current = null
      commitCandidate(pendingCandidate)
    }, remainingMs)

    return clearPendingTimer
  }, [isLiveProgress, nextCandidate])

  if (!isLiveProgress || shouldBypassHeaderStabilization(displayCandidateRef.current, nextCandidate)) {
    return nextCandidate
  }

  if (displayCandidateRef.current.key === nextCandidate.key) {
    return nextCandidate
  }

  return displayCandidate
}

interface ToolBlockGroupHeaderContentProps {
  items: ToolRenderItem[]
  activityLabel?: React.ReactNode
  elapsedText?: React.ReactNode
  summary?: React.ReactNode
  isLiveProgress?: boolean
  preferSummary?: boolean
  showLatestWhenComplete?: boolean
}

const DynamicToolBlockGroupHeaderContent = React.memo(
  ({
    items,
    activityLabel,
    elapsedText,
    summary,
    isLiveProgress,
    preferSummary,
    showLatestWhenComplete
  }: ToolBlockGroupHeaderContentProps) => {
    const { t } = useTranslation()
    const partsMap = usePartsMap()
    const allCompleted = items.every((item) => isToolGroupItemCompleted(item.toolResponse.status))
    const fallbackLabel = summary ?? t('message.tools.groupHeader', { count: items.length })
    const nextCandidate = React.useMemo<ToolHeaderCandidate>(() => {
      if (preferSummary) {
        return { key: `summary:${String(fallbackLabel)}`, kind: 'summary', label: fallbackLabel }
      }

      if (activityLabel) {
        return { key: getActivityCandidateKey(activityLabel), kind: 'activity', label: activityLabel }
      }

      if (allCompleted && !showLatestWhenComplete) {
        return { key: `summary:${String(fallbackLabel)}`, kind: 'summary', label: fallbackLabel }
      }

      // Find items actually waiting for approval (using effective status)
      const waitingItems = items.filter((item) => getItemEffectiveStatus(item, partsMap) === 'waiting')

      // Prioritize showing waiting items that need approval
      const lastWaitingItem = waitingItems[waitingItems.length - 1]
      if (lastWaitingItem) {
        return { key: `${lastWaitingItem.id}:waiting`, kind: 'tool', item: lastWaitingItem, status: 'waiting' }
      }

      // Find running items (invoking or streaming)
      const runningItems = items.filter((item) => {
        const status = getItemEffectiveStatus(item, partsMap)
        return status === 'invoking' || status === 'streaming'
      })

      // Get the last running item (most recent) and render with animation
      const lastRunningItem = runningItems[runningItems.length - 1]
      if (lastRunningItem) {
        const lastRunningStatus = getItemEffectiveStatus(lastRunningItem, partsMap)
        return {
          key: `${lastRunningItem.id}:${lastRunningStatus}`,
          kind: 'tool',
          item: lastRunningItem,
          status: lastRunningStatus
        }
      }

      const latestItem = showLatestWhenComplete ? items.at(-1) : undefined
      if (latestItem) {
        const effectiveStatus = getItemEffectiveStatus(latestItem, partsMap)
        const latestStatus = latestItem.toolResponse.response?.isError === true ? 'error' : effectiveStatus
        return { key: `${latestItem.id}:${latestStatus}`, kind: 'tool', item: latestItem, status: latestStatus }
      }

      return { key: `summary:${String(fallbackLabel)}`, kind: 'summary', label: fallbackLabel }
    }, [activityLabel, allCompleted, fallbackLabel, items, partsMap, preferSummary, showLatestWhenComplete])
    const displayCandidate = useStableHeaderCandidate(nextCandidate, isLiveProgress)
    const renderWithElapsed = (content: React.ReactNode) => (
      <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[13px]">
        <div className="min-w-0 overflow-hidden">{content}</div>
        {elapsedText && (
          <>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/40">
              ·
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted-foreground/55">{elapsedText}</span>
          </>
        )}
      </div>
    )

    if (displayCandidate.kind === 'summary') {
      return renderWithElapsed(
        <div className="flex items-center text-[13px]">
          <span className="whitespace-nowrap font-normal text-foreground-secondary transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
            {displayCandidate.label}
          </span>
        </div>
      )
    }

    if (displayCandidate.kind === 'activity') {
      return renderWithElapsed(
        <div className="flex min-w-0 items-center text-[13px]">
          <PlaceholderShimmerText className="truncate font-normal text-foreground-secondary transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
            {displayCandidate.label}
          </PlaceholderShimmerText>
        </div>
      )
    }

    return renderWithElapsed(
      <div className="min-w-0 max-w-full overflow-hidden" key={displayCandidate.item.id}>
        <ToolHeader
          toolResponse={displayCandidate.item.toolResponse}
          variant="collapse-label"
          status={displayCandidate.status}
          shimmer={isLiveProgress}
        />
      </div>
    )
  }
)
DynamicToolBlockGroupHeaderContent.displayName = 'DynamicToolBlockGroupHeaderContent'

export const ToolBlockGroupHeaderContent = React.memo((props: ToolBlockGroupHeaderContentProps) => {
  const { t } = useTranslation()
  const { activityLabel, elapsedText, items, preferSummary, showLatestWhenComplete, summary } = props
  const allCompleted = items.every((item) => isToolGroupItemCompleted(item.toolResponse.status))
  const fallbackLabel = summary ?? t('message.tools.groupHeader', { count: items.length })

  if (preferSummary || (allCompleted && !showLatestWhenComplete && !activityLabel)) {
    return (
      <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[13px]">
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center text-[13px]">
            <span className="whitespace-nowrap font-normal text-foreground-secondary transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
              {fallbackLabel}
            </span>
          </div>
        </div>
        {elapsedText && (
          <>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/40">
              ·
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted-foreground/55">{elapsedText}</span>
          </>
        )}
      </div>
    )
  }

  return <DynamicToolBlockGroupHeaderContent {...props} />
})
ToolBlockGroupHeaderContent.displayName = 'ToolBlockGroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolBlockGroupContentProps {
  items: ToolRenderItem[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

export const ToolBlockGroupContent = React.memo(({ items, scrollRef }: ToolBlockGroupContentProps) => (
  <div ref={scrollRef} className="tool-block-group-content flex w-full flex-col gap-2">
    {items.map((item) => {
      return (
        <div key={item.id} data-block-id={item.id} className="w-full">
          <ErrorBoundary fallbackComponent={BlockErrorFallback}>
            <MessageTools toolResponse={item.toolResponse} />
          </ErrorBoundary>
        </div>
      )
    })}
  </div>
))
ToolBlockGroupContent.displayName = 'ToolBlockGroupContent'

interface ToolBlockGroupProps {
  children?: React.ReactNode
  items: ToolRenderItem[]
}

/** A nested, independently collapsible group of adjacent tool calls. */
export const ToolBlockGroup = React.memo(({ children, items }: ToolBlockGroupProps) => {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
  const isLiveProgress = items.some((item) => !isToolGroupItemCompleted(item.toolResponse.status))

  return (
    <div ref={anchorRef} className="group/child-tool-group w-full max-w-full" data-testid="child-tool-group">
      <Accordion
        type="single"
        collapsible
        value={isExpanded ? 'tools' : ''}
        onValueChange={(value) => withScrollAnchor(() => setIsExpanded(value === 'tools'), { settleAfterMs: 220 })}>
        <AccordionItem value="tools" className="border-0 first:border-t-0">
          <AccordionTrigger className="group/tool-group-trigger h-auto min-h-7 w-fit max-w-full flex-none justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left font-normal shadow-none hover:no-underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-0 [&>svg]:size-3.5 [&>svg]:opacity-0 [&>svg]:transition-[transform,opacity] hover:[&>svg]:opacity-60 focus-visible:[&>svg]:opacity-60 [&[data-state=open]>svg]:opacity-60">
            <div className="min-w-0 overflow-hidden">
              <ToolBlockGroupHeaderContent items={items} isLiveProgress={isLiveProgress} />
            </div>
          </AccordionTrigger>
          <AccordionContent
            data-testid="child-tool-group-content"
            className="p-0 pt-1 text-inherit"
            contentClassName="text-inherit motion-safe:data-[state=open]:[animation-duration:200ms] motion-safe:data-[state=closed]:[animation-duration:160ms] motion-reduce:animate-none">
            {children ?? <ToolBlockGroupContent items={items} />}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
})
ToolBlockGroup.displayName = 'ToolBlockGroup'
