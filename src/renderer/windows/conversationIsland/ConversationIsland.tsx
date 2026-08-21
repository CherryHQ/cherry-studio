import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import type {
  ConversationIslandActivityItem,
  ConversationIslandSnapshot,
  ConversationIslandStateKind
} from '@shared/types/conversationIsland'
import { useEffect, useRef } from 'react'

const logger = loggerService.withContext('ConversationIsland')

const STATE_INDICATOR_CLASS: Record<ConversationIslandStateKind, string> = {
  pending: 'bg-info motion-safe:animate-pulse motion-reduce:animate-none',
  streaming: 'bg-primary motion-safe:animate-pulse motion-reduce:animate-none',
  'awaiting-confirmation': 'bg-warning',
  done: 'bg-success',
  error: 'bg-error'
}

const EXPAND_DELAY_MS = 500
const COLLAPSE_DELAY_MS = 250

type FreshReentryState = 'idle' | 'waiting-for-compact-enter' | 'left-before-compact' | 'waiting-for-leave'

export default function ConversationIsland() {
  const snapshot = useWindowInitData<ConversationIslandSnapshot>()
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const freshReentryRef = useRef<FreshReentryState>('idle')

  useEffect(() => {
    if (snapshot?.expanded || snapshot?.secondaryCount === 0) {
      if (expandTimerRef.current !== null) clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
    if (!snapshot?.expanded) {
      if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
  }, [snapshot?.expanded, snapshot?.secondaryCount])

  useEffect(
    () => () => {
      if (expandTimerRef.current !== null) clearTimeout(expandTimerRef.current)
      if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current)
    },
    []
  )

  if (!snapshot) {
    return null
  }

  const clearExpandTimer = () => {
    if (expandTimerRef.current !== null) clearTimeout(expandTimerRef.current)
    expandTimerRef.current = null
  }

  const clearCollapseTimer = () => {
    if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
  }

  const clearTimers = () => {
    clearExpandTimer()
    clearCollapseTimer()
  }

  const handlePointerEnter = () => {
    clearCollapseTimer()

    if (freshReentryRef.current === 'left-before-compact') {
      if (snapshot.expanded) {
        freshReentryRef.current = 'waiting-for-leave'
        return
      }
      freshReentryRef.current = 'idle'
    } else if (freshReentryRef.current !== 'idle') {
      if (!snapshot.expanded && freshReentryRef.current === 'waiting-for-compact-enter') {
        freshReentryRef.current = 'waiting-for-leave'
      }
      return
    }

    if (snapshot.expanded || snapshot.secondaryCount === 0 || expandTimerRef.current !== null) return

    expandTimerRef.current = setTimeout(() => {
      expandTimerRef.current = null
      void ipcApi
        .request('conversation_island.set_expanded', { expanded: true })
        .catch((error) => logger.error('Failed to expand Conversation Island', error as Error))
    }, EXPAND_DELAY_MS)
  }

  const handlePointerLeave = () => {
    clearExpandTimer()

    if (freshReentryRef.current !== 'idle') {
      clearCollapseTimer()
      if (snapshot.expanded && freshReentryRef.current === 'waiting-for-compact-enter') {
        freshReentryRef.current = 'left-before-compact'
      } else if (!snapshot.expanded && freshReentryRef.current === 'waiting-for-leave') {
        freshReentryRef.current = 'idle'
      }
      return
    }

    if (!snapshot.expanded || collapseTimerRef.current !== null) return

    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null
      void ipcApi
        .request('conversation_island.set_expanded', { expanded: false })
        .catch((error) => logger.error('Failed to collapse Conversation Island', error as Error))
    }, COLLAPSE_DELAY_MS)
  }

  const usesNotchLayout =
    snapshot.presentation === 'notch' &&
    typeof snapshot.notchWidth === 'number' &&
    Number.isFinite(snapshot.notchWidth) &&
    snapshot.notchWidth > 0

  const stateIndicator = (state: ConversationIslandStateKind) => (
    <span className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[state]}`} aria-hidden="true" />
  )

  const openActivity = async (activity: ConversationIslandActivityItem) => {
    try {
      await ipcApi.request('navigation.focus_or_open_conversation', {
        target: activity.target,
        title: activity.title
      })
    } catch (error) {
      logger.error('Failed to open conversation from Conversation Island', error as Error)
    }
  }

  const openExpandedActivity = async (activity: ConversationIslandActivityItem) => {
    freshReentryRef.current = 'waiting-for-compact-enter'
    clearTimers()

    try {
      await ipcApi.request('conversation_island.set_expanded', { expanded: false })
    } catch (error) {
      logger.error('Failed to collapse Conversation Island before navigation', error as Error)
    }

    await openActivity(activity)
  }

  if (snapshot.expanded) {
    const activities = snapshot.activities ?? []

    return (
      <div
        data-testid="conversation-island-surface"
        data-state={snapshot.state}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className={
          usesNotchLayout
            ? 'h-full w-full overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black pt-[38px] text-white'
            : 'h-full w-full overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-md'
        }>
        <div role="list" className="max-h-[220px] overflow-y-auto">
          {activities.map((activity) => {
            const isPrimary = activity.activityId === snapshot.activityId

            return (
              <div role="listitem" key={activity.activityId}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${activity.statusText}: ${activity.title}`}
                  data-state={activity.state}
                  onClick={() => void openExpandedActivity(activity)}
                  className={`h-11 min-h-11 w-full min-w-0 justify-start rounded-md px-3 py-0 text-xs shadow-none ${
                    usesNotchLayout
                      ? `${isPrimary ? 'bg-white/10 font-medium' : 'font-normal'} text-white hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white`
                      : `${isPrimary ? 'bg-accent font-medium' : 'font-normal'} text-popover-foreground hover:bg-accent focus-visible:bg-accent`
                  }`}>
                  {stateIndicator(activity.state)}
                  <span className="shrink-0">{activity.statusText}</span>
                  <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{activity.title}</span>
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => void openActivity(snapshot)}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-testid="conversation-island-surface"
      data-state={snapshot.state}
      className={
        usesNotchLayout
          ? 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black px-0 py-0 text-white text-xs shadow-none hover:bg-black hover:text-white focus-visible:bg-black focus-visible:text-white'
          : 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-full border border-border bg-popover/95 px-3 py-0 text-popover-foreground text-xs shadow-md backdrop-blur-xs hover:bg-accent focus-visible:bg-accent'
      }>
      {usesNotchLayout ? (
        <span className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <span data-testid="notch-leading" className="flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-left">
            {stateIndicator(snapshot.state)}
            <span className="min-w-0 truncate font-medium">{snapshot.statusText}</span>
          </span>
          <span data-testid="notch-occlusion" aria-hidden="true" style={{ width: snapshot.notchWidth }} />
          <span
            data-testid="notch-trailing"
            className="flex min-w-0 items-center justify-end gap-2 overflow-hidden pr-3">
            <span className="min-w-0 truncate text-white/60">{snapshot.title}</span>
            {snapshot.secondaryCount > 0 ? (
              <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-white/70">+{snapshot.secondaryCount}</span>
            ) : null}
          </span>
        </span>
      ) : (
        <>
          {stateIndicator(snapshot.state)}
          <span className="shrink-0 font-medium">{snapshot.statusText}</span>
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{snapshot.title}</span>
          {snapshot.secondaryCount > 0 ? (
            <span className="shrink-0 rounded-full bg-accent px-1.5 text-muted-foreground">
              +{snapshot.secondaryCount}
            </span>
          ) : null}
        </>
      )}
    </Button>
  )
}
