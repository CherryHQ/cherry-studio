import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { BaseService, Conditional, DependsOn, Injectable, onPlatform, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import { type Display, nativeTheme, screen, systemPreferences } from 'electron'

import { type ConversationIslandActivity, reduceActivities, selectPrimaryActivity } from './activityReducer'
import { ConversationIslandNativeHost } from './ConversationIslandNativeHost'
import type {
  ConversationIslandActivityItem,
  ConversationIslandHelperEvent,
  ConversationIslandPresentationPayload,
  ConversationIslandStateKind
} from './conversationIslandProtocol'
import {
  createExpandedActivityState,
  type ExpandedActivityState,
  reconcileExpandedActivityState,
  resolveExpandedActivities
} from './expandedActivityState'

const logger = loggerService.withContext('Conversation Island')
const TOPIC_STATUS_PREFIX = 'topic.stream.statuses.'
const DEFAULT_AGENT_AVATAR = '🤖'
const DEFAULT_PRIMARY_COLOR = '#00B96B'
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

type SetExpandedEvent = Extract<ConversationIslandHelperEvent, { type: 'setExpanded' }>
type OpenActivityEvent = Extract<ConversationIslandHelperEvent, { type: 'openActivity' }>

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

function prefersReducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion
  } catch {
    return true
  }
}

function resolvePrimaryColor(value: unknown): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : DEFAULT_PRIMARY_COLOR
}

@Injectable('ConversationIslandService')
@Conditional(onPlatform('darwin'))
@DependsOn(['WindowManager', 'ConversationNavigationService'])
@ServicePhase(Phase.WhenReady)
export class ConversationIslandService extends BaseService {
  private readonly activities = new Map<string, ConversationIslandActivity>()
  private readonly itemMetadataCache = new Map<string, ActivityItemMetadata>()
  private host: ConversationIslandNativeHost | null = null
  private enabled = false
  private expandedState: ExpandedActivityState | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private revision = 0
  private currentPresentationRevision: number | null = null
  private currentPresentationActivityIds = new Set<string>()
  private hasPresentation = false

  protected onInit(): void {
    this.host = new ConversationIslandNativeHost({
      callbacks: {
        onSetExpanded: (event) => this.handleSetExpanded(event),
        onOpenActivity: (event) => this.handleOpenActivity(event)
      }
    })

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
    this.registerDisposable(
      preferences.subscribeChange('ui.theme_user.color_primary', () => this.refreshPresentation())
    )
    this.registerDisposable(preferences.subscribeChange('ui.theme_user.font_family', () => this.refreshPresentation()))

    const refreshTheme = () => this.refreshPresentation()
    nativeTheme.on('updated', refreshTheme)
    this.registerDisposable(() => nativeTheme.removeListener('updated', refreshTheme))

    this.setEnabled(preferences.get('feature.conversation_island.enabled'))
  }

  protected async onStop(): Promise<void> {
    const host = this.host
    this.host = null
    this.enabled = false
    this.expandedState = null
    this.hasPresentation = false
    this.currentPresentationActivityIds.clear()
    this.clearExpiryTimer()
    this.activities.clear()
    this.itemMetadataCache.clear()
    await host?.shutdown()
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
      this.clearExpiryTimer()
      this.dismiss(true)
      for (const [topicId, activity] of this.activities) {
        if (isTerminal(activity.status)) this.activities.delete(topicId)
      }
      this.pruneItemMetadataCache()
      return
    }

    this.host?.resetCircuit()
    this.refreshPresentation()
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

  private handleSetExpanded(event: SetExpandedEvent): void {
    if (!this.enabled || event.revision !== this.currentPresentationRevision) return
    this.setExpanded(event.expanded)
  }

  private handleOpenActivity(event: OpenActivityEvent): void {
    if (
      !this.enabled ||
      event.revision !== this.currentPresentationRevision ||
      !this.currentPresentationActivityIds.has(event.activityId)
    ) {
      return
    }

    const activity = this.activities.get(event.activityId)
    if (!activity) return
    const title = this.buildActivityItem(activity).title

    this.expandedState = null
    this.refreshPresentation()
    void application
      .get('ConversationNavigationService')
      .focusOrOpen(activity.target, title)
      .catch((error) =>
        logger.error('Failed to open Conversation Island activity', { activityId: event.activityId, error })
      )
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
    if (!this.enabled) return

    if (this.expandedState) {
      const expandedState = reconcileExpandedActivityState(this.expandedState, this.activities, now)
      this.expandedState = expandedState
      if (expandedState) {
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
          this.present(primary, activities, display.id)
          return
        }
      }
      this.expandedState = null
    }

    this.presentCompact(now)
    this.scheduleNextExpiry(now)
  }

  private presentCompact(now: number): void {
    const selection = selectPrimaryActivity(this.activities, now)
    this.pruneItemMetadataCache()
    if (!selection.primary) {
      if (this.hasPresentation) this.dismiss(false)
      this.clearExpiryTimer()
      return
    }

    const display = this.resolveActivityDisplay(selection.primary.originDisplayId)
    this.present(selection.primary, [selection.primary], display.id, selection.secondaryCount + 1)
  }

  private present(
    primary: ConversationIslandActivity,
    activities: ConversationIslandActivity[],
    displayId: number,
    activityCount = activities.length
  ): void {
    const payload: ConversationIslandPresentationPayload = {
      displayId,
      expanded: this.expandedState !== null,
      reducedMotion: prefersReducedMotion(),
      theme: this.resolveTheme(),
      primaryActivityId: primary.topicId,
      activityCount,
      activityCountText: t('conversation_island.activity_count', { count: activityCount }),
      activities: activities.map((activity) => this.buildActivityItem(activity))
    }
    const revision = this.nextRevision()

    this.hasPresentation = true
    this.currentPresentationRevision = revision
    this.currentPresentationActivityIds = new Set(payload.activities.map((activity) => activity.activityId))
    this.host?.present({ version: 1, type: 'present', revision, payload })
  }

  private dismiss(terminateAfterHidden: boolean): void {
    const revision = this.nextRevision()
    this.hasPresentation = false
    this.currentPresentationRevision = revision
    this.currentPresentationActivityIds.clear()
    this.host?.dismiss({ version: 1, type: 'dismiss', revision }, terminateAfterHidden)
  }

  private nextRevision(): number {
    if (this.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Conversation Island revision exhausted')
    this.revision += 1
    return this.revision
  }

  private resolveTheme(): ConversationIslandPresentationPayload['theme'] {
    const preferences = application.get('PreferenceService')
    const fontFamily = preferences.get('ui.theme_user.font_family')
    return {
      appearance: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      primaryColor: resolvePrimaryColor(preferences.get('ui.theme_user.color_primary')),
      fontFamily: typeof fontFamily === 'string' ? fontFamily : ''
    }
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
}
