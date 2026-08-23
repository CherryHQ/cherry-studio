import { Button, EmojiIcon } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import type {
  ConversationIslandActivityItem,
  ConversationIslandSnapshot,
  ConversationIslandStateKind
} from '@shared/types/conversationIsland'
import { Bot, MessageCircle } from 'lucide-react'
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

function ConversationIslandStateIndicator({ state }: { state: ConversationIslandStateKind }) {
  return (
    <span
      data-testid="state-indicator"
      className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[state]}`}
      aria-hidden="true"
    />
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
  const ActivityIcon = snapshot.target.conversationType === 'agent' ? Bot : MessageCircle
  const surfaceModel = resolveConversationIslandSurface(snapshot)
  const usesSingleNotchDetail = usesNotchLayout && surfaceModel.kind === 'single-detail'

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

  const activities =
    surfaceModel.kind === 'activity-list'
      ? surfaceModel.activities
      : [surfaceModel.kind === 'single-detail' ? surfaceModel.activity : surfaceModel.primary]
  const surface = snapshot.expanded ? (
    <div
      data-testid="conversation-island-surface"
      data-state={snapshot.state}
      aria-hidden={snapshot.exiting ? true : undefined}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className={`${
        usesNotchLayout
          ? 'h-full w-full overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black text-white'
          : 'h-full w-full overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-md'
      } ${snapshot.exiting ? 'pointer-events-none' : ''}`}>
      {usesNotchLayout ? (
        <div
          data-testid="notch-expanded-header"
          className="grid h-[38px] w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] text-xs">
          <div
            data-testid="notch-expanded-leading"
            className="flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-left">
            {usesSingleNotchDetail ? (
              <>
                <IdentityAvatar avatar={snapshot.identityAvatar} />
                <span className="min-w-0 truncate">{snapshot.identityName}</span>
              </>
            ) : (
              <>
                <ActivityIcon
                  data-testid="notch-activity-icon"
                  data-conversation-type={snapshot.target.conversationType}
                  className="size-3.5 shrink-0 text-white/70"
                  aria-hidden="true"
                />
                <ConversationIslandStateIndicator state={snapshot.state} />
                <span className="min-w-0 truncate">{snapshot.statusText}</span>
              </>
            )}
          </div>
          <div data-testid="notch-expanded-occlusion" aria-hidden="true" style={{ width: snapshot.notchWidth }} />
          <div
            data-testid="notch-expanded-trailing"
            className={`flex min-w-0 items-center justify-end overflow-hidden pr-3 text-white/60 ${usesSingleNotchDetail ? 'gap-2' : ''}`}>
            {usesSingleNotchDetail ? (
              <>
                <ConversationIslandStateIndicator state={snapshot.state} />
                <span className="min-w-0 truncate">{snapshot.statusText}</span>
              </>
            ) : (
              <span className="min-w-0 truncate">{snapshot.activityCountText}</span>
            )}
          </div>
        </div>
      ) : null}
      <div role="list" className="max-h-[220px] overflow-y-auto">
        {activities.map((activity) => {
          const isPrimary =
            surfaceModel.kind !== 'activity-list' || activity.activityId === surfaceModel.primaryActivityId

          return (
            <div role="listitem" key={activity.activityId}>
              <Button
                type="button"
                variant="ghost"
                aria-label={`${activity.statusText}: ${activity.title}`}
                data-state={activity.state}
                disabled={snapshot.exiting}
                onClick={() => void openExpandedActivity(activity)}
                className={`h-11 min-h-11 w-full min-w-0 justify-start rounded-md px-3 py-0 text-xs shadow-none ${
                  usesNotchLayout
                    ? `${isPrimary ? 'bg-white/10 font-medium' : 'font-normal'} text-white hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white`
                    : `${isPrimary ? 'bg-accent font-medium' : 'font-normal'} text-popover-foreground hover:bg-accent focus-visible:bg-accent`
                }`}>
                {usesSingleNotchDetail ? null : <ConversationIslandStateIndicator state={activity.state} />}
                {usesSingleNotchDetail ? null : <span className="shrink-0">{activity.statusText}</span>}
                <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{activity.title}</span>
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  ) : (
    <Button
      type="button"
      variant="ghost"
      aria-hidden={snapshot.exiting ? true : undefined}
      disabled={snapshot.exiting}
      onClick={() => void openActivity(snapshot)}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-testid="conversation-island-surface"
      data-state={snapshot.state}
      className={`${
        usesNotchLayout
          ? 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black px-0 py-0 text-white text-xs shadow-none hover:bg-black hover:text-white focus-visible:bg-black focus-visible:text-white'
          : 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-full border border-border bg-popover/95 px-3 py-0 text-popover-foreground text-xs shadow-md backdrop-blur-xs hover:bg-accent focus-visible:bg-accent'
      } ${snapshot.exiting ? 'pointer-events-none' : ''}`}>
      {usesNotchLayout ? (
        <span className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <span data-testid="notch-leading" className="flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-left">
            <ConversationIslandStateIndicator state={snapshot.state} />
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
          <ConversationIslandStateIndicator state={snapshot.state} />
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
          key={snapshot.expanded ? 'expanded' : 'compact'}
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
