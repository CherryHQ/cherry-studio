import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import {
  BaseService,
  Conditional,
  DependsOn,
  type Disposable,
  Injectable,
  onPlatform,
  Phase,
  ServicePhase
} from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import type {
  ConversationIslandActivityItem,
  ConversationIslandSnapshot,
  ConversationIslandStateKind
} from '@shared/types/conversationIsland'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import { type Display, type Rectangle, screen, systemPreferences } from 'electron'

import { type ConversationIslandActivity, reduceActivities, selectPrimaryActivity } from './activityReducer'
import {
  createExpandedActivityState,
  type ExpandedActivityState,
  reconcileExpandedActivityState,
  resolveExpandedActivities
} from './expandedActivityState'
import {
  COMPACT_ISLAND_SIZE,
  type ConversationIslandPlacement,
  type MacScreenGeometry,
  probeMacScreenGeometry,
  resolveConversationIslandBounds,
  resolveConversationIslandSize
} from './macScreenGeometry'

const logger = loggerService.withContext('Conversation Island')
const TOPIC_STATUS_PREFIX = 'topic.stream.statuses.'
const EXIT_ANIMATION_MS = 180
const DEFAULT_AGENT_AVATAR = '🤖'

interface ConversationActivityChangedEvent {
  topicId: string
  target: ConversationNavigationTarget
  snapshot: TopicStatusSnapshotEntry | null
  changedAt: number
}

interface ActivityItemMetadata {
  turnId?: string
  title: string
  identityName: string
  identityAvatar: string
}

function snapshotState(status: ConversationIslandActivity['status']): ConversationIslandStateKind {
  return status === 'awaiting-approval' ? 'awaiting-confirmation' : status
}

function statusText(activity: ConversationIslandActivity): string {
  if (activity.status === 'awaiting-approval') return t('conversation_island.status.awaiting_confirmation')

  if (activity.target.conversationType === 'agent') {
    switch (activity.status) {
      case 'pending':
        return t('conversation_island.status.agent.pending')
      case 'streaming':
        return t('conversation_island.status.agent.streaming')
      case 'done':
        return t('conversation_island.status.agent.done')
      case 'error':
        return t('conversation_island.status.agent.error')
    }
  }

  switch (activity.status) {
    case 'pending':
      return t('conversation_island.status.assistant.pending')
    case 'streaming':
      return t('conversation_island.status.assistant.streaming')
    case 'done':
      return t('conversation_island.status.assistant.done')
    case 'error':
      return t('conversation_island.status.assistant.error')
  }
}

function isTerminal(status: ConversationIslandActivity['status']): boolean {
  return status === 'done' || status === 'error'
}

function sameBounds(left: Rectangle, right: Rectangle): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}

function prefersReducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion
  } catch {
    return true
  }
}

@Injectable('ConversationIslandService')
@Conditional(onPlatform('darwin'))
@DependsOn(['WindowManager', 'PowerService'])
@ServicePhase(Phase.WhenReady)
export class ConversationIslandService extends BaseService {
  private readonly activities = new Map<string, ConversationIslandActivity>()
  private readonly itemMetadataCache = new Map<string, ActivityItemMetadata>()
  private geometries = new Map<number, MacScreenGeometry>()
  private enabled = false
  private expandedState: ExpandedActivityState | null = null
  private windowId: string | null = null
  private positionedWindowId: string | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private exitTimer: ReturnType<typeof setTimeout> | null = null
  private lastSnapshot: ConversationIslandSnapshot | null = null
  private probeController: AbortController | null = null
  private screenCleanup: (() => void) | null = null
  private powerResumeSubscription: Disposable | null = null

  protected onInit(): void {
    const windowManager = application.get('WindowManager')
    this.registerDisposable(
      windowManager.onWindowCreatedByType(WindowType.ConversationIsland, ({ id }) => {
        this.windowId = id
        this.positionedWindowId = null
      })
    )
    this.registerDisposable(
      windowManager.onWindowDestroyedByType(WindowType.ConversationIsland, ({ id }) => {
        if (this.windowId === id) {
          this.clearExitTimer()
          this.windowId = null
          this.positionedWindowId = null
          this.expandedState = null
          this.lastSnapshot = null
        }
      })
    )

    const cacheService = application.get('CacheService')
    this.registerDisposable(
      cacheService.subscribeSharedChange('topic.stream.statuses.${topicId}', (snapshot, _oldSnapshot, key) =>
        this.handleConversationActivitySnapshot(snapshot, key)
      )
    )
    this.registerDisposable(
      cacheService.subscribeSharedChange(
        'topic.stream.statuses.agent-session:${sessionId}',
        (snapshot, _oldSnapshot, key) => this.handleConversationActivitySnapshot(snapshot, key)
      )
    )

    const preferences = application.get('PreferenceService')
    this.registerDisposable(
      preferences.subscribeChange('feature.conversation_island.enabled', (enabled) => this.setEnabled(enabled))
    )
    this.registerDisposable(
      preferences.subscribeChange('app.language', () => {
        this.itemMetadataCache.clear()
        this.refreshPresentation()
      })
    )

    this.setEnabled(preferences.get('feature.conversation_island.enabled'))
  }

  protected onStop(): void {
    this.enabled = false
    this.expandedState = null
    this.deactivateResources()
    this.activities.clear()
    this.itemMetadataCache.clear()
  }

  private handleConversationActivitySnapshot(
    snapshot: TopicStatusSnapshotEntry | null | undefined,
    concreteKey: string
  ): void {
    const topicId = concreteKey.slice(TOPIC_STATUS_PREFIX.length)
    if (!topicId) return

    this.handleConversationActivity({
      topicId,
      target: this.resolveConversationTarget(topicId),
      snapshot: snapshot ?? null,
      changedAt: Date.now()
    })
  }

  private resolveConversationTarget(topicId: string): ConversationNavigationTarget {
    return isAgentSessionTopic(topicId)
      ? { conversationType: 'agent', conversationId: extractAgentSessionId(topicId) }
      : { conversationType: 'assistant', conversationId: topicId }
  }

  private handleConversationActivity(event: ConversationActivityChangedEvent): void {
    const previous = this.activities.get(event.topicId)
    const status = event.snapshot?.awaitingApprovalAnchors.length
      ? 'awaiting-approval'
      : (event.snapshot?.status ?? null)
    const isNewPending =
      status === 'pending' && (!previous || previous.turnId !== event.snapshot?.turnId || isTerminal(previous.status))
    const isRemoval = status === null || status === 'aborted'
    const originDisplayId = isNewPending
      ? this.resolveOriginDisplayId()
      : (previous?.originDisplayId ?? (isRemoval ? -1 : this.resolveFallbackDisplay().id))

    reduceActivities(this.activities, {
      topicId: event.topicId,
      turnId: event.snapshot?.turnId,
      target: event.target,
      status,
      changedAt: event.changedAt,
      originDisplayId
    })

    if (this.enabled) this.refreshPresentation()
    else {
      if (status === 'done' || status === 'error') this.activities.delete(event.topicId)
      selectPrimaryActivity(this.activities, Date.now())
      this.pruneItemMetadataCache()
    }
  }

  private setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled

    if (!enabled) {
      this.expandedState = null
      this.deactivateResources()
      for (const [topicId, activity] of this.activities) {
        if (isTerminal(activity.status)) this.activities.delete(topicId)
      }
      this.pruneItemMetadataCache()
      return
    }

    try {
      this.activateResources()
    } catch (error) {
      logger.error('Failed to activate Conversation Island resources', error as Error)
      this.deactivateResources()
      this.enabled = false
    }
  }

  private activateResources(): void {
    const refreshGeometry = () => {
      this.expandedState = null
      this.refreshPresentation()
      this.probeGeometry()
    }

    screen.on('display-added', refreshGeometry)
    screen.on('display-removed', refreshGeometry)
    screen.on('display-metrics-changed', refreshGeometry)
    this.screenCleanup = () => {
      screen.removeListener('display-added', refreshGeometry)
      screen.removeListener('display-removed', refreshGeometry)
      screen.removeListener('display-metrics-changed', refreshGeometry)
    }
    this.powerResumeSubscription = application.get('PowerService').onResume(refreshGeometry)

    this.probeGeometry()
    this.refreshPresentation()
  }

  private deactivateResources(): void {
    this.expandedState = null
    this.screenCleanup?.()
    this.screenCleanup = null
    this.powerResumeSubscription?.dispose()
    this.powerResumeSubscription = null
    this.probeController?.abort()
    this.probeController = null
    this.clearExpiryTimer()
    this.closeIslandWindow()
  }

  public setExpanded(expanded: boolean): void {
    if (!expanded) {
      if (!this.expandedState) return
      this.expandedState = null
      this.refreshPresentation()
      return
    }

    if (!this.enabled || this.expandedState) return

    const now = Date.now()
    const selection = selectPrimaryActivity(this.activities, now)
    if (!selection.primary) return

    const display = this.resolveActivityDisplay(selection.primary.originDisplayId)
    const expandedState = createExpandedActivityState(this.activities, now, display.id)
    if (!expandedState) return

    this.expandedState = expandedState
    this.clearExpiryTimer()
    this.refreshPresentation(now)
  }

  private probeGeometry(): void {
    this.probeController?.abort()
    const controller = new AbortController()
    this.probeController = controller

    void probeMacScreenGeometry(controller.signal)
      .then((geometries) => {
        if (!this.enabled || controller.signal.aborted || this.probeController !== controller) return
        this.geometries = geometries
        this.refreshPresentation()
      })
      .catch((error) => {
        if (!controller.signal.aborted) logger.warn('Failed to refresh Conversation Island geometry', { error })
      })
      .finally(() => {
        if (this.probeController === controller) this.probeController = null
      })
  }

  private resolveOriginDisplayId(): number {
    try {
      const focused = getFullChromeWindowInfos().find((window) => window.isFocused)
      if (focused) {
        const window = application.get('WindowManager').getWindow(focused.id)
        if (window && !window.isDestroyed()) return screen.getDisplayMatching(window.getBounds()).id
      }
    } catch (error) {
      logger.warn('Failed to resolve the originating display', { error })
    }
    return this.resolveFallbackDisplay().id
  }

  private resolveFallbackDisplay(): Display {
    const displays = screen.getAllDisplays()
    return displays.find((display) => display.internal) ?? screen.getPrimaryDisplay()
  }

  private resolveActivityDisplay(originDisplayId: number): Display {
    const displays = screen.getAllDisplays()
    return (
      displays.find((display) => display.id === originDisplayId) ??
      displays.find((display) => display.internal) ??
      screen.getPrimaryDisplay()
    )
  }

  private refreshPresentation(now = Date.now()): void {
    if (!this.enabled) {
      this.expandedState = null
      this.closeIslandWindow()
      this.clearExpiryTimer()
      return
    }

    if (this.expandedState) {
      const expandedState = reconcileExpandedActivityState(this.expandedState, this.activities, now)
      this.expandedState = expandedState
      if (!expandedState) this.expandedState = null
      else {
        const display = screen.getAllDisplays().find((candidate) => candidate.id === expandedState.displayId)
        if (!display) {
          this.expandedState = null
          return this.refreshPresentation(now)
        }
        const activities = resolveExpandedActivities(expandedState, this.activities)
        const primary = activities.find((activity) => activity.topicId === expandedState.primaryActivityId)
        if (primary) {
          this.pruneItemMetadataCache()
          this.clearExpiryTimer()
          try {
            const compactPlacement = resolveConversationIslandBounds(display, this.geometries, COMPACT_ISLAND_SIZE)
            const size = resolveConversationIslandSize(compactPlacement.presentation, activities.length)
            const placement = resolveConversationIslandBounds(display, this.geometries, size)
            const snapshot = this.buildSnapshot(primary, activities.length - 1, placement, activities)
            this.showOrUpdateWindow(snapshot, placement.bounds)
            return
          } catch (error) {
            logger.error('Failed to present expanded Conversation Island activity', error as Error)
            this.expandedState = null
            try {
              this.presentCompact(now)
            } catch (compactError) {
              logger.error('Failed to restore compact Conversation Island activity', compactError as Error)
              this.dismissIslandWindow()
            }
            this.scheduleNextExpiry(now)
            return
          }
        }
        this.expandedState = null
      }
    }

    try {
      this.presentCompact(now)
    } catch (error) {
      logger.error('Failed to present Conversation Island activity', error as Error)
      this.dismissIslandWindow()
    }

    this.scheduleNextExpiry(now)
  }

  private presentCompact(now: number): void {
    const selection = selectPrimaryActivity(this.activities, now)
    this.pruneItemMetadataCache()
    if (!selection.primary) {
      this.beginExit()
      this.clearExpiryTimer()
      return
    }

    const display = this.resolveActivityDisplay(selection.primary.originDisplayId)
    const placement = resolveConversationIslandBounds(display, this.geometries, COMPACT_ISLAND_SIZE)
    const snapshot = this.buildSnapshot(selection.primary, selection.secondaryCount, placement)
    this.showOrUpdateWindow(snapshot, placement.bounds)
  }

  private buildActivityItem(activity: ConversationIslandActivity): ConversationIslandActivityItem {
    let metadata = this.itemMetadataCache.get(activity.topicId)
    if (!metadata || metadata.turnId !== activity.turnId) {
      metadata = { turnId: activity.turnId, ...this.resolveItemMetadata(activity.target) }
      this.itemMetadataCache.set(activity.topicId, metadata)
    }

    return {
      activityId: activity.topicId,
      identityAvatar: metadata.identityAvatar,
      identityName: metadata.identityName,
      target: activity.target,
      state: snapshotState(activity.status),
      statusText: statusText(activity),
      title: metadata.title
    }
  }

  private resolveItemMetadata(target: ConversationNavigationTarget): Omit<ActivityItemMetadata, 'turnId'> {
    const fallbackTitle = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
    const fallbackIdentityName =
      target.conversationType === 'agent'
        ? t('conversation_island.identity.agent')
        : t('conversation_island.identity.assistant')
    const fallbackIdentityAvatar = target.conversationType === 'agent' ? DEFAULT_AGENT_AVATAR : DEFAULT_ASSISTANT_EMOJI
    const fallback = {
      title: fallbackTitle,
      identityName: fallbackIdentityName,
      identityAvatar: fallbackIdentityAvatar
    }

    try {
      if (target.conversationType === 'agent') {
        const session = agentSessionService.getById(target.conversationId)
        const title = session.name.trim() || fallbackTitle
        if (!session.agentId) return { ...fallback, title }

        try {
          const agent = agentService.getAgent(session.agentId)
          return {
            title,
            identityName: agent?.name.trim() || fallbackIdentityName,
            identityAvatar: agent?.configuration?.avatar?.trim() || fallbackIdentityAvatar
          }
        } catch (error) {
          logger.warn('Failed to resolve Conversation Island agent identity', {
            agentId: session.agentId,
            err: error
          })
          return { ...fallback, title }
        }
      }

      const topic = topicService.getById(target.conversationId)
      const title = topic.name.trim() || fallbackTitle
      if (!topic.assistantId) return { ...fallback, title }

      try {
        const assistant = assistantDataService.getById(topic.assistantId)
        return {
          title,
          identityName: assistant.name.trim() || fallbackIdentityName,
          identityAvatar: assistant.emoji.trim() || fallbackIdentityAvatar
        }
      } catch (error) {
        logger.warn('Failed to resolve Conversation Island assistant identity', {
          assistantId: topic.assistantId,
          err: error
        })
        return { ...fallback, title }
      }
    } catch (error) {
      logger.warn('Failed to resolve Conversation Island activity metadata', { target, err: error })
      return fallback
    }
  }

  private buildSnapshot(
    activity: ConversationIslandActivity,
    secondaryCount: number,
    placement: ConversationIslandPlacement,
    activities?: ConversationIslandActivity[]
  ): ConversationIslandSnapshot {
    const activityCount = secondaryCount + 1

    return {
      ...this.buildActivityItem(activity),
      activityCountText: t('conversation_island.activity_count', { count: activityCount }),
      secondaryCount,
      presentation: placement.presentation,
      notchWidth: placement.notchWidth,
      expanded: activities !== undefined,
      exiting: false,
      reducedMotion: prefersReducedMotion(),
      ...(activities ? { activities: activities.map((item) => this.buildActivityItem(item)) } : {})
    }
  }

  private showOrUpdateWindow(snapshot: ConversationIslandSnapshot, bounds: Rectangle): void {
    this.cancelExit()
    const windowManager = application.get('WindowManager')

    if (this.windowId && !windowManager.pushInitData(this.windowId, snapshot)) this.windowId = null
    if (!this.windowId) this.windowId = windowManager.open(WindowType.ConversationIsland, { initData: snapshot })

    const window = windowManager.getWindow(this.windowId)
    if (!window || window.isDestroyed()) throw new Error('Conversation Island window is unavailable')
    const isInitialPosition = this.positionedWindowId !== this.windowId
    if (isInitialPosition || !sameBounds(window.getBounds(), bounds)) {
      window.setBounds(bounds, isInitialPosition ? false : !snapshot.reducedMotion)
      this.positionedWindowId = this.windowId
    }
    window.showInactive()
    this.lastSnapshot = snapshot
  }

  private scheduleNextExpiry(now: number): void {
    this.clearExpiryTimer()
    let nextExpiry: number | undefined
    for (const activity of this.activities.values()) {
      if (activity.expiresAt !== undefined && (nextExpiry === undefined || activity.expiresAt < nextExpiry)) {
        nextExpiry = activity.expiresAt
      }
    }
    if (nextExpiry === undefined) return

    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = null
        this.refreshPresentation()
      },
      Math.max(0, nextExpiry - now)
    )
    this.expiryTimer.unref()
  }

  private pruneItemMetadataCache(): void {
    for (const topicId of this.itemMetadataCache.keys()) {
      if (!this.activities.has(topicId)) this.itemMetadataCache.delete(topicId)
    }
  }

  private clearExpiryTimer(): void {
    if (!this.expiryTimer) return
    clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }

  private clearExitTimer(): void {
    if (!this.exitTimer) return
    clearTimeout(this.exitTimer)
    this.exitTimer = null
  }

  private beginExit(): void {
    const windowId = this.windowId
    const snapshot = this.lastSnapshot
    if (!windowId || !snapshot || snapshot.reducedMotion) {
      this.closeIslandWindow()
      return
    }

    const windowManager = application.get('WindowManager')
    const window = windowManager.getWindow(windowId)
    if (!window || window.isDestroyed()) {
      this.closeIslandWindow()
      return
    }
    if (this.exitTimer) return
    if (!windowManager.pushInitData(windowId, { ...snapshot, exiting: true })) {
      this.closeIslandWindow()
      return
    }

    this.exitTimer = setTimeout(() => {
      this.exitTimer = null
      if (this.windowId === windowId) this.closeIslandWindow()
    }, EXIT_ANIMATION_MS)
    this.exitTimer.unref()
  }

  private cancelExit(): void {
    this.clearExitTimer()
  }

  private closeIslandWindow(): void {
    this.clearExitTimer()
    this.lastSnapshot = null
    this.positionedWindowId = null
    this.expandedState = null
    const windowId = this.windowId
    this.windowId = null
    if (!windowId) return
    try {
      application.get('WindowManager').close(windowId)
    } catch (error) {
      logger.error('Failed to close Conversation Island window', error as Error)
    }
  }

  private dismissIslandWindow(): void {
    if (this.windowId) {
      try {
        application.get('WindowManager').getWindow(this.windowId)?.hide()
      } catch (error) {
        logger.error('Failed to hide Conversation Island window', error as Error)
      }
    }
    this.closeIslandWindow()
  }
}
