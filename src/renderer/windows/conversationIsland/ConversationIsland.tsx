import { Button, EmojiIcon } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import type {
  ConversationIslandActivityItem,
  ConversationIslandSnapshot,
  ConversationIslandStateKind
} from '@shared/types/conversationIsland'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { resolveConversationIslandMotion } from './conversationIslandMotion'
import { resolveConversationIslandSurface } from './conversationIslandSurface'

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

function IdentityAvatar({ avatar }: { avatar: string }) {
  return (
    <span aria-hidden="true" className="shrink-0">
      <EmojiIcon emoji={avatar || '🤖'} className="mr-0" size={18} fontSize={11} />
    </span>
  )
}

export default function ConversationIsland() {
  const snapshot = useWindowInitData<ConversationIslandSnapshot>()
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const freshReentryRef = useRef<FreshReentryState>('idle')

  useEffect(() => {
    if (snapshot?.exiting) {
      if (expandTimerRef.current !== null) clearTimeout(expandTimerRef.current)
      if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current)
      expandTimerRef.current = null
      collapseTimerRef.current = null
      return
    }

    if (snapshot?.expanded) {
      if (expandTimerRef.current !== null) clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
    if (!snapshot?.expanded) {
      if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
  }, [snapshot?.expanded, snapshot?.exiting])

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

  const surfaceModel = resolveConversationIslandSurface(snapshot)

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
    if (snapshot.exiting) return

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

    if (snapshot.expanded || expandTimerRef.current !== null) return

    expandTimerRef.current = setTimeout(() => {
      expandTimerRef.current = null
      void ipcApi
        .request('conversation_island.set_expanded', { expanded: true })
        .catch((error) => logger.error('Failed to expand Conversation Island', error as Error))
    }, EXPAND_DELAY_MS)
  }

  const handlePointerLeave = () => {
    if (snapshot.exiting) return

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
    <span
      data-testid="state-indicator"
      className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[state]}`}
      aria-hidden="true"
    />
  )

  const openActivity = async (activity: ConversationIslandActivityItem) => {
    if (snapshot.exiting) return

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
    if (snapshot.exiting) return

    freshReentryRef.current = 'waiting-for-compact-enter'
    clearTimers()

    try {
      await ipcApi.request('conversation_island.set_expanded', { expanded: false })
    } catch (error) {
      logger.error('Failed to collapse Conversation Island before navigation', error as Error)
    }

    await openActivity(activity)
  }

  const surface = (() => {
    if (surfaceModel.kind === 'compact') {
      const { primary, totalCount } = surfaceModel
      const countBadge =
        totalCount > 1 ? (
          <span
            aria-label={snapshot.activityCountText}
            className={`shrink-0 rounded-full px-1.5 ${
              usesNotchLayout ? 'bg-white/10 text-white/70' : 'bg-accent text-muted-foreground'
            }`}>
            {totalCount}
          </span>
        ) : null

      return (
        <Button
          type="button"
          variant="ghost"
          aria-hidden={snapshot.exiting ? true : undefined}
          disabled={snapshot.exiting}
          onClick={() => void openActivity(primary)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          data-testid="conversation-island-surface"
          data-state={primary.state}
          className={`${
            usesNotchLayout
              ? 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black px-0 py-0 text-white text-xs shadow-none hover:bg-black hover:text-white focus-visible:bg-black focus-visible:text-white'
              : 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-full border border-border bg-popover/95 px-3 py-0 text-popover-foreground text-xs shadow-md backdrop-blur-xs hover:bg-accent focus-visible:bg-accent'
          } ${snapshot.exiting ? 'pointer-events-none' : ''}`}>
          {usesNotchLayout ? (
            <span className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <span
                data-testid="notch-leading"
                className="flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-left">
                {stateIndicator(primary.state)}
                <span className="min-w-0 truncate">{primary.statusText}</span>
              </span>
              <span data-testid="notch-occlusion" aria-hidden="true" style={{ width: snapshot.notchWidth }} />
              <span
                data-testid="notch-trailing"
                className="flex min-w-0 items-center justify-end gap-2 overflow-hidden pr-3 text-white/60">
                {countBadge ?? <span className="min-w-0 truncate">{primary.title}</span>}
              </span>
            </span>
          ) : (
            <span className="flex w-full min-w-0 items-center gap-3">
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left">
                {stateIndicator(primary.state)}
                <span className="min-w-0 truncate">{primary.statusText}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                {countBadge ?? <span className="min-w-0 truncate">{primary.title}</span>}
              </span>
            </span>
          )}
        </Button>
      )
    }

    const isSingleDetail = surfaceModel.kind === 'single-detail'
    const primary = isSingleDetail
      ? surfaceModel.activity
      : surfaceModel.activities.find((activity) => activity.activityId === surfaceModel.primaryActivityId)!
    const summaryLeading = isSingleDetail ? (
      <>
        <IdentityAvatar avatar={primary.identityAvatar} />
        <span className={`min-w-0 truncate ${usesNotchLayout ? 'text-white/70' : 'text-muted-foreground'}`}>
          {primary.identityName}
        </span>
      </>
    ) : (
      <span className={`min-w-0 truncate ${usesNotchLayout ? 'text-white/70' : 'text-muted-foreground'}`}>
        {snapshot.activityCountText}
      </span>
    )
    const summaryTrailing = isSingleDetail ? (
      <>
        {stateIndicator(primary.state)}
        <span className="min-w-0 truncate">{primary.statusText}</span>
      </>
    ) : null
    const summary = usesNotchLayout ? (
      <div
        data-testid="notch-expanded-header"
        className="grid h-[38px] w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] text-xs">
        <div
          data-testid="notch-expanded-leading"
          className={`flex min-w-0 items-center overflow-hidden pl-3 text-left ${isSingleDetail ? 'gap-0.5' : 'gap-2'}`}>
          {summaryLeading}
        </div>
        <div data-testid="notch-expanded-occlusion" aria-hidden="true" style={{ width: snapshot.notchWidth }} />
        <div
          data-testid="notch-expanded-trailing"
          className="flex min-w-0 items-center justify-end gap-2 overflow-hidden pr-3 text-white/60">
          {summaryTrailing}
        </div>
      </div>
    ) : (
      <div
        data-testid="capsule-expanded-header"
        className="flex h-[38px] w-full min-w-0 items-center justify-between gap-3 px-3 text-xs">
        <div className={`flex min-w-0 items-center overflow-hidden text-left ${isSingleDetail ? 'gap-0.5' : 'gap-2'}`}>
          {summaryLeading}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden text-muted-foreground">
          {summaryTrailing}
        </div>
      </div>
    )
    const body = isSingleDetail ? (
      <Button
        type="button"
        variant="ghost"
        aria-label={`${primary.statusText}: ${primary.title}`}
        data-state={primary.state}
        disabled={snapshot.exiting}
        onClick={() => void openExpandedActivity(primary)}
        className={`h-[44px] min-h-[44px] w-full min-w-0 justify-start rounded-none px-3 py-0 font-normal text-xs shadow-none ${
          usesNotchLayout
            ? 'text-white hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white'
            : 'text-popover-foreground hover:bg-accent focus-visible:bg-accent'
        }`}>
        <span className="min-w-0 flex-1 truncate text-left">{primary.title}</span>
      </Button>
    ) : (
      <div role="list" className="max-h-[208px] overflow-y-auto">
        {surfaceModel.activities.map((activity) => (
          <div role="listitem" key={activity.activityId}>
            <Button
              type="button"
              variant="ghost"
              aria-label={`${activity.statusText}: ${activity.title}`}
              data-state={activity.state}
              disabled={snapshot.exiting}
              onClick={() => void openExpandedActivity(activity)}
              className={`h-[52px] min-h-[52px] w-full min-w-0 flex-col items-stretch justify-center gap-2 rounded-none px-3 py-0 font-normal text-xs shadow-none ${
                usesNotchLayout
                  ? 'text-white hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white'
                  : 'text-popover-foreground hover:bg-accent focus-visible:bg-accent'
              }`}>
              <span className="flex w-full min-w-0 items-center justify-between gap-3 leading-4">
                <span
                  className={`flex min-w-0 items-center gap-0.5 overflow-hidden ${
                    usesNotchLayout ? 'text-white/60' : 'text-muted-foreground'
                  }`}>
                  <IdentityAvatar avatar={activity.identityAvatar} />
                  <span className="min-w-0 truncate">{activity.identityName}</span>
                </span>
                <span
                  className={`flex shrink-0 items-center gap-2 ${
                    usesNotchLayout ? 'text-white/60' : 'text-muted-foreground'
                  }`}>
                  {stateIndicator(activity.state)}
                  <span>{activity.statusText}</span>
                </span>
              </span>
              <span className="w-full min-w-0 truncate text-left leading-4">{activity.title}</span>
            </Button>
          </div>
        ))}
      </div>
    )

    return (
      <div
        data-testid="conversation-island-surface"
        data-state={primary.state}
        aria-hidden={snapshot.exiting ? true : undefined}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className={`${
          usesNotchLayout
            ? 'h-full w-full overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black text-white'
            : 'h-full w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md'
        } ${snapshot.exiting ? 'pointer-events-none' : ''}`}>
        {summary}
        {body}
      </div>
    )
  })()

  const motionPlan = resolveConversationIslandMotion({
    exiting: snapshot.exiting,
    reducedMotion: snapshot.reducedMotion
  })
  const contentTransition = snapshot.reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 224, damping: 25, mass: 1 }

  return (
    <motion.div
      data-testid="conversation-island-motion"
      className="h-full w-full"
      style={{ transformOrigin: '50% 0%' }}
      initial={motionPlan.initial}
      animate={motionPlan.animate}
      transition={motionPlan.transition}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={surfaceModel.kind}
          className="h-full w-full"
          layout={!snapshot.reducedMotion}
          initial={snapshot.reducedMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={snapshot.reducedMotion ? undefined : { opacity: 0, scale: 0.98 }}
          transition={contentTransition}>
          {surface}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}
