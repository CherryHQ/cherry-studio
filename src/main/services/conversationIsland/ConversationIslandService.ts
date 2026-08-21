import { application } from '@application'
import { loggerService } from '@logger'
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
import type { ConversationActivityChangedEvent } from '@main/services/NotificationService'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import type { ConversationIslandSnapshot, ConversationIslandStateKind } from '@shared/types/conversationIsland'
import { type Display, type Rectangle, screen } from 'electron'

import { type ConversationIslandActivity, reduceActivities, selectPrimaryActivity } from './activityReducer'
import { type MacScreenGeometry, probeMacScreenGeometry, resolveConversationIslandBounds } from './macScreenGeometry'

const logger = loggerService.withContext('ConversationIslandService')
const ISLAND_WIDTH = 320

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

@Injectable('ConversationIslandService')
@Conditional(onPlatform('darwin'))
@DependsOn(['NotificationService', 'WindowManager', 'PowerService'])
@ServicePhase(Phase.WhenReady)
export class ConversationIslandService extends BaseService {
  private readonly activities = new Map<string, ConversationIslandActivity>()
  private readonly titleCache = new Map<string, { turnId?: string; title: string }>()
  private geometries = new Map<number, MacScreenGeometry>()
  private enabled = false
  private showTitle = true
  private windowId: string | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private probeController: AbortController | null = null
  private screenCleanup: (() => void) | null = null
  private powerResumeSubscription: Disposable | null = null

  protected onInit(): void {
    const windowManager = application.get('WindowManager')
    this.registerDisposable(
      windowManager.onWindowCreatedByType(WindowType.ConversationIsland, ({ id }) => {
        this.windowId = id
      })
    )
    this.registerDisposable(
      windowManager.onWindowDestroyedByType(WindowType.ConversationIsland, ({ id }) => {
        if (this.windowId === id) this.windowId = null
      })
    )

    this.registerDisposable(
      application
        .get('NotificationService')
        .onConversationActivityChanged((event) => this.handleConversationActivity(event))
    )

    const preferences = application.get('PreferenceService')
    this.showTitle = preferences.get('feature.conversation_island.show_title')
    this.registerDisposable(
      preferences.subscribeChange('feature.conversation_island.enabled', (enabled) => this.setEnabled(enabled))
    )
    this.registerDisposable(
      preferences.subscribeChange('feature.conversation_island.show_title', (showTitle) => {
        this.showTitle = showTitle
        this.refreshPresentation()
      })
    )
    this.registerDisposable(
      preferences.subscribeChange('app.language', () => {
        this.titleCache.clear()
        this.refreshPresentation()
      })
    )

    this.setEnabled(preferences.get('feature.conversation_island.enabled'))
  }

  protected onStop(): void {
    this.enabled = false
    this.deactivateResources()
    this.activities.clear()
    this.titleCache.clear()
  }

  private handleConversationActivity(event: ConversationActivityChangedEvent): void {
    const previous = this.activities.get(event.topicId)
    const status = event.snapshot?.status ?? null
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
      selectPrimaryActivity(this.activities, Date.now())
      this.pruneTitleCache()
    }
  }

  private setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled

    if (!enabled) {
      this.deactivateResources()
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
    this.screenCleanup?.()
    this.screenCleanup = null
    this.powerResumeSubscription?.dispose()
    this.powerResumeSubscription = null
    this.probeController?.abort()
    this.probeController = null
    this.clearExpiryTimer()
    this.closeIslandWindow()
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
    const selection = selectPrimaryActivity(this.activities, now)
    this.pruneTitleCache()
    if (!this.enabled || !selection.primary) {
      this.closeIslandWindow()
      this.clearExpiryTimer()
      return
    }

    try {
      const display = this.resolveActivityDisplay(selection.primary.originDisplayId)
      const placement = resolveConversationIslandBounds(display, this.geometries, ISLAND_WIDTH)
      const snapshot = this.buildSnapshot(selection.primary, selection.secondaryCount, placement.presentation)
      this.showOrUpdateWindow(snapshot, placement.bounds)
    } catch (error) {
      logger.error('Failed to present Conversation Island activity', error as Error)
    }

    this.scheduleNextExpiry(now)
  }

  private buildSnapshot(
    activity: ConversationIslandActivity,
    secondaryCount: number,
    presentation: ConversationIslandSnapshot['presentation']
  ): ConversationIslandSnapshot {
    const fallback = activity.target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
    let title: string | undefined
    if (this.showTitle) {
      const cached = this.titleCache.get(activity.topicId)
      title = cached && cached.turnId === activity.turnId ? cached.title : undefined
      if (title === undefined) {
        title = application.get('NotificationService').resolveConversationName(activity.target)
        this.titleCache.set(activity.topicId, { turnId: activity.turnId, title })
      }
    }

    return {
      activityId: activity.topicId,
      target: activity.target,
      state: snapshotState(activity.status),
      statusText: statusText(activity),
      title,
      navigationTitle: title ?? fallback,
      secondaryCount,
      presentation
    }
  }

  private showOrUpdateWindow(snapshot: ConversationIslandSnapshot, bounds: Rectangle): void {
    const windowManager = application.get('WindowManager')

    if (this.windowId && !windowManager.pushInitData(this.windowId, snapshot)) this.windowId = null
    if (!this.windowId) this.windowId = windowManager.open(WindowType.ConversationIsland, { initData: snapshot })

    const window = windowManager.getWindow(this.windowId)
    if (!window || window.isDestroyed()) throw new Error('Conversation Island window is unavailable')
    window.setBounds(bounds)
    window.showInactive()
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

  private pruneTitleCache(): void {
    for (const topicId of this.titleCache.keys()) {
      if (!this.activities.has(topicId)) this.titleCache.delete(topicId)
    }
  }

  private clearExpiryTimer(): void {
    if (!this.expiryTimer) return
    clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }

  private closeIslandWindow(): void {
    if (!this.windowId) return
    const windowId = this.windowId
    this.windowId = null
    try {
      application.get('WindowManager').close(windowId)
    } catch (error) {
      logger.error('Failed to close Conversation Island window', error as Error)
    }
  }
}
