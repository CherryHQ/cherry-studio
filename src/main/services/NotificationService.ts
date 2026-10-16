import { eq } from 'drizzle-orm'
import { app, Notification as ElectronNotification } from 'electron'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { messageService } from '@data/services/MessageService'
import { modelService } from '@data/services/ModelService'
import { notificationRecordService } from '@data/services/NotificationRecordService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import {
  getContextUsageModelCandidates,
  isExpectedModelUsage,
  resolveMaxTokens
} from '@shared/ai/agentSessionContextUsage'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import type { CreateNotificationRecordInput } from '@shared/data/types/notification'
import { hasClearContextPart } from '@shared/data/types/uiParts'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import {
  CONVERSATION_NOTIFICATION_ACTION_KEY,
  type ConversationNotification,
  type Notification,
  type NotificationSource
} from '@shared/types/notification'

import { openNotificationInMainWindow, openRouteInMainWindow } from './mainWindowNavigation'

const logger = loggerService.withContext('NotificationService')
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

interface ContextNotificationState {
  stage: string
  activeModel?: string
  models: Record<string, { stage: string; warned: boolean }>
}

/** OS notification category gates — all off means the Dock badge must clear (#20709). */
const OS_NOTIFICATION_PREF_KEYS = [
  'app.notification.assistant.enabled',
  'app.notification.backup.enabled',
  'app.notification.knowledge.enabled',
  'app.notification.update.enabled',
  'app.notification.mini_app.enabled',
  'app.notification.usage.os.enabled'
] as const satisfies readonly UnifiedPreferenceKeyType[]

function isConversationTarget(meta: unknown): meta is ConversationNavigationTarget {
  if (!meta || typeof meta !== 'object') return false

  const candidate = meta as Partial<ConversationNavigationTarget>
  return (
    (candidate.conversationType === 'assistant' || candidate.conversationType === 'agent') &&
    typeof candidate.conversationId === 'string' &&
    candidate.conversationId.length > 0
  )
}

@Injectable('NotificationService')
@DependsOn(['AgentSessionRuntimeService', 'AiStreamManager', 'ConversationNavigationService'])
@ServicePhase(Phase.WhenReady)
export class NotificationService extends BaseService {
  private budgetSnapshot?: { day: string; total: number }
  private pendingBudgetDay?: string

  protected onInit(): void {
    this.registerDisposable(
      application.get('AiStreamManager').onConversationCompleted((event) => this.handleConversationCompleted(event))
    )
    this.registerDisposable(
      application.get('AiStreamManager').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
    this.registerDisposable(
      application.get('AgentSessionRuntimeService').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges([...OS_NOTIFICATION_PREF_KEYS], () => this.syncDockBadgeWithNotificationPrefs())
    )
    this.syncDockBadgeWithNotificationPrefs()
    this.refreshDailyBudget(true)
    this.registerDisposable(aiUsageRecordService.onInvocationsRecorded(() => this.refreshDailyBudget()))
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges(
          [
            'app.notification.center.usage.enabled',
            'app.notification.daily_budget.tokens',
            'app.notification.daily_budget.threshold'
          ],
          () => this.refreshDailyBudget(true)
        )
    )
    this.registerDisposable(
      application
        .get('CacheService')
        .subscribeSharedChange('agent.session.context_usage.${sessionId}', (usage, _old, key) => {
          const sessionId = key.slice('agent.session.context_usage.'.length)
          const topicId = `agent-session:${sessionId}`
          if (!usage) {
            this.resetContextUsage(topicId)
            return
          }
          try {
            const session = agentSessionService.getById(sessionId)
            const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
            const model = agent?.model
              ? modelService.findByIdTx(application.get('DbService').getDb(), agent.model)
              : undefined
            if (!isExpectedModelUsage(usage, getContextUsageModelCandidates(model ?? undefined))) return
            const max = resolveMaxTokens(usage, model?.contextWindow)
            if (max)
              void this.observeContextUsage({ topicId, model: model?.id ?? usage.model, used: usage.totalTokens, max })
          } catch (error) {
            logger.warn('Failed to resolve Agent context usage', { error })
          }
        })
    )
    const purge = () => {
      try {
        notificationRecordService.purgeExpired()
      } catch (error) {
        logger.warn('Failed to expire notification history', { error })
      }
    }
    purge()
    this.registerInterval(purge, 24 * 60 * 60 * 1000)
  }

  public async publish(
    input: CreateNotificationRecordInput,
    options: { source?: NotificationSource; completion?: boolean } = {}
  ): Promise<boolean> {
    let committed = false
    try {
      const preferences = application.get('PreferenceService')
      if (!preferences.get(`app.notification.center.${input.category}.enabled`)) return true
      if (
        input.kind === 'task-completion' &&
        input.target?.kind === 'conversation' &&
        getFullChromeWindowInfos().some((window) => window.isFocused) &&
        (await application.get('ConversationNavigationService').isActiveInFocusedWindow(input.target))
      )
        return true
      const record = notificationRecordService.create(input)
      if (!record) return true
      committed = true
      const windows = getFullChromeWindowInfos()
      const focused = windows.find((window) => window.isFocused)
      const owner = focused ?? windows.find((window) => window.type === WindowType.Main) ?? windows[0]
      const sound = options.completion && preferences.get('app.notification.completion_sound.enabled')
      if (sound && owner) {
        try {
          application.get('IpcApiService').send(owner.id, 'notification.completion_sound', { id: record.id })
        } catch (error) {
          logger.warn('Failed to play completion sound', { error })
        }
      }
      if (focused) {
        if (options.completion || input.category === 'usage') {
          application.get('IpcApiService').send(focused.id, 'notification.present', record)
        }
        return true
      }
      const osKey =
        input.category === 'usage'
          ? 'app.notification.usage.os.enabled'
          : options.source && options.source !== 'mini-app'
            ? (`app.notification.${options.source}.enabled` as const)
            : undefined
      if (!osKey || !preferences.get(osKey)) return true
      const notification = new ElectronNotification({
        title: record.title,
        body: record.message,
        ...(sound ? { silent: true } : {})
      })
      notification.on('click', () => {
        void this.activateNotification(record.id).catch((error) =>
          logger.warn('Failed to open notification target', { error })
        )
      })
      notification.show()
      return true
    } catch (error) {
      logger.warn('Failed to publish notification', { error, eventKey: input.eventKey })
      return committed
    }
  }

  public async activateNotification(id: string): Promise<void> {
    const record = notificationRecordService.getById(id)
    if (!record) throw new Error(t('notification.center.target_unavailable'))
    notificationRecordService.markRead(id)
    const target = record.target
    if (!target) return
    if (target.kind === 'conversation') {
      try {
        const entity =
          target.conversationType === 'agent'
            ? agentSessionService.getById(target.conversationId)
            : topicService.getById(target.conversationId)
        if (entity.deletedAt) throw new Error('Deleted conversation')
      } catch {
        throw new Error(t('notification.center.target_unavailable'))
      }
      const conversation = { conversationType: target.conversationType, conversationId: target.conversationId }
      await application
        .get('ConversationNavigationService')
        .focusOrOpen(conversation, this.resolveConversationName(target))
    } else if (target.kind === 'settings') {
      openRouteInMainWindow(`/settings/${target.tab}`)
    } else if (target.kind === 'knowledge') {
      try {
        knowledgeBaseService.getById(target.baseId)
      } catch {
        throw new Error(t('notification.center.target_unavailable'))
      }
      openRouteInMainWindow(`/app/knowledge?baseId=${encodeURIComponent(target.baseId)}`)
    } else {
      openNotificationInMainWindow(id)
    }
  }

  public resetContextUsage(topicId: string): void {
    try {
      this.writeState(`notification:context:${topicId}`, { stage: crypto.randomUUID(), models: {} })
    } catch (error) {
      logger.warn('Failed to reset context notification', { error })
    }
  }

  public async observeContextUsage(input: {
    topicId: string
    model: string
    used: number
    max: number
    stage?: string
  }): Promise<void> {
    try {
      if (!Number.isFinite(input.used) || input.used < 0 || !Number.isFinite(input.max) || input.max <= 0) return
      const key = `notification:context:${input.topicId}`
      let state = this.readState<ContextNotificationState>(key)
      if (isAgentSessionTopic(input.topicId) && state?.activeModel && state.activeModel !== input.model) {
        this.resetContextUsage(input.topicId)
        state = this.readState<ContextNotificationState>(key)
      }
      const stage = input.stage ?? state?.stage ?? 'initial'
      const previous = state?.models[input.model]
      if (previous?.stage === stage && previous.warned) return
      const warned = input.used / input.max >= 0.9
      if (previous?.stage === stage && previous.warned === warned) return
      if (!warned) {
        this.writeState(key, {
          stage: state?.stage ?? 'initial',
          activeModel: input.model,
          models: { ...state?.models, [input.model]: { stage, warned } }
        })
        return
      }
      const recorded = await this.publish({
        eventKey: `context:${JSON.stringify([input.topicId, input.model, stage])}`,
        category: 'usage',
        kind: 'context-warning',
        createdAt: Date.now(),
        title: t('notification.center.context_title'),
        message: t('notification.center.context_message', { percent: Math.round((input.used / input.max) * 100) }),
        target: { kind: 'conversation', ...this.resolveConversationTarget(input.topicId) }
      })
      if (!recorded) return
      const current = this.readState<ContextNotificationState>(key)
      if ((current?.stage ?? 'initial') !== (state?.stage ?? 'initial')) return
      this.writeState(key, {
        stage: current?.stage ?? 'initial',
        activeModel: input.model,
        models: { ...current?.models, [input.model]: { stage, warned } }
      })
    } catch (error) {
      logger.warn('Failed to observe context usage', { error })
    }
  }

  private refreshDailyBudget(baseline = false): void {
    try {
      const preferences = application.get('PreferenceService')
      const budget = preferences.get('app.notification.daily_budget.tokens')
      const threshold = preferences.get('app.notification.daily_budget.threshold')
      if (
        !preferences.get('app.notification.center.usage.enabled') ||
        !Number.isSafeInteger(budget) ||
        budget <= 0 ||
        !Number.isInteger(threshold) ||
        threshold < 1 ||
        threshold > 100
      ) {
        this.budgetSnapshot = undefined
        this.pendingBudgetDay = undefined
        return
      }
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1
      const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
      const total = aiUsageRecordService.stats({ from, to, groupBy: 'model', metric: 'tokens', limit: 1 }).totals
        .totalTokens
      const previous = this.budgetSnapshot
      this.budgetSnapshot = { day, total }
      if (baseline || !previous) {
        this.pendingBudgetDay = undefined
        return
      }
      const prior = previous.day === day ? previous.total : 0
      const limit = (budget * threshold) / 100
      if (
        (prior >= limit && this.pendingBudgetDay !== day) ||
        total < limit ||
        this.readState<string>('notification:daily-budget') === day
      )
        return
      this.pendingBudgetDay = day
      void this.publish({
        eventKey: `daily-budget:${day}`,
        category: 'usage',
        kind: 'daily-budget',
        createdAt: Date.now(),
        title: t('notification.center.budget_title'),
        message: t('notification.center.budget_message', {
          percent: Math.round((total / budget) * 100),
          used: total,
          budget
        }),
        target: { kind: 'settings', tab: 'usage' }
      })
        .then((recorded) => {
          if (recorded) {
            this.writeState('notification:daily-budget', day)
            if (this.pendingBudgetDay === day) this.pendingBudgetDay = undefined
          }
        })
        .catch((error) => logger.warn('Failed to retain daily notification marker', { error }))
    } catch (error) {
      logger.warn('Failed to check daily notification budget', { error })
    }
  }

  private readState<T>(key: string): T | undefined {
    return application
      .get('DbService')
      .getDb()
      .select({ value: appStateTable.value })
      .from(appStateTable)
      .where(eq(appStateTable.key, key))
      .get()?.value as T | undefined
  }

  private writeState(key: string, value: unknown): void {
    application
      .get('DbService')
      .getDb()
      .insert(appStateTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: appStateTable.key, set: { value, updatedAt: Date.now() } })
      .run()
  }

  public async sendNotification(notification: Notification): Promise<void> {
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message,
      ...(notification.silent === undefined ? {} : { silent: notification.silent })
    })

    electronNotification.on('click', () => {
      if (notification.actionKey === CONVERSATION_NOTIFICATION_ACTION_KEY && isConversationTarget(notification.meta)) {
        void application
          .get('ConversationNavigationService')
          .focusOrOpen(notification.meta, this.resolveConversationName(notification.meta))
          .catch((error) => logger.error('Failed to open conversation from notification', error as Error))
        return
      }

      application.get('MainWindowService').showMainWindow()
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'notification.clicked', notification)
    })

    electronNotification.show()
  }

  public async observeChatContextUsage({
    topicId,
    modelId,
    tokens,
    anchorMessageId
  }: {
    topicId: string
    modelId: UniqueModelId
    tokens: number
    anchorMessageId?: string
  }): Promise<void> {
    try {
      const model = modelService.findByIdTx(application.get('DbService').getDb(), modelId)
      if (!model?.contextWindow || !anchorMessageId) return
      const path = messageService.getPathToNode(anchorMessageId)
      const boundary = path.findLast((message) => hasClearContextPart(message.data.parts) || message.compactionSummary)
      const compacted = path
        .flatMap((message) => message.data.parts ?? [])
        .findLast((part) => part.type === 'data-compaction-anchor' && part.data.status === 'done')
      await this.observeContextUsage({
        topicId,
        model: modelId,
        used: tokens,
        max: model.contextWindow,
        stage: `${boundary?.id ?? 'initial'}:${compacted?.type === 'data-compaction-anchor' ? compacted.id : ''}`
      })
    } catch (error) {
      logger.warn('Failed to resolve chat context usage', { error })
    }
  }

  private handleConversationCompleted({
    topicId,
    turnId,
    completedAt,
    responseText,
    completedTaskCount
  }: ConversationCompletedEvent): void {
    const target = this.resolveConversationTarget(topicId)
    const fallbackTitle =
      target.conversationType === 'agent' ? t('notification.completion.agent') : t('notification.completion.assistant')
    const conversationName = this.resolveConversationName(target, fallbackTitle)
    const lastSentence = [...sentenceSegmenter.segment(responseText?.trim() ?? '')].at(-1)?.segment.trim()
    void this.publish(
      {
        eventKey: `task-completion:${topicId}:${turnId}`,
        category: 'system',
        kind: completedTaskCount && completedTaskCount > 1 ? 'queue-completion' : 'task-completion',
        title:
          completedTaskCount && completedTaskCount > 1
            ? t('notification.center.queue_complete', { count: completedTaskCount })
            : fallbackTitle,
        message: lastSentence
          ? conversationName === fallbackTitle
            ? lastSentence
            : `${conversationName}\n${lastSentence}`
          : conversationName,
        createdAt: completedAt,
        target: { kind: 'conversation', ...target }
      },
      { source: 'assistant', completion: true }
    )
  }

  private handleApprovalRequested({ topicId, approvalId, requestedAt }: ApprovalRequestedEvent): void {
    const target = this.resolveConversationTarget(topicId)
    const title =
      target.conversationType === 'agent'
        ? t('notification.action_required.agent')
        : t('notification.action_required.assistant')
    const conversationName = this.resolveConversationName(target)
    this.deliverConversationNotification({
      id: `approval-request:${approvalId}`,
      kind: 'approval-request',
      type: 'warning',
      title,
      conversationName,
      message: conversationName,
      timestamp: requestedAt,
      actionKey: CONVERSATION_NOTIFICATION_ACTION_KEY,
      meta: target,
      source: 'assistant'
    })
  }

  private deliverConversationNotification(notification: ConversationNotification): void {
    const focusedWindow = getFullChromeWindowInfos().find((window) => window.isFocused)
    if (focusedWindow) {
      application.get('IpcApiService').send(focusedWindow.id, 'notification.conversation', notification)
      return
    }

    if (!application.get('PreferenceService').get('app.notification.assistant.enabled')) return
    void this.sendNotification(notification)
  }

  private areAllOsNotificationPrefsDisabled(): boolean {
    const preferences = application.get('PreferenceService')
    return OS_NOTIFICATION_PREF_KEYS.every((key) => !preferences.get(key))
  }

  /** macOS Notification Center can leave a Dock count after prefs are all off (#20709). */
  private syncDockBadgeWithNotificationPrefs(): void {
    if (!this.areAllOsNotificationPrefsDisabled()) return
    app.setBadgeCount(0)
  }

  private resolveConversationTarget(topicId: string): ConversationNavigationTarget {
    return isAgentSessionTopic(topicId)
      ? { conversationType: 'agent', conversationId: extractAgentSessionId(topicId) }
      : { conversationType: 'assistant', conversationId: topicId }
  }

  private resolveConversationName(
    target: ConversationNavigationTarget,
    fallback = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
  ): string {
    try {
      const name =
        target.conversationType === 'agent'
          ? agentSessionService.getById(target.conversationId).name
          : topicService.getById(target.conversationId).name
      return name.trim() || fallback
    } catch (error) {
      logger.warn('Failed to resolve conversation name for notification', { target, err: error })
      return fallback
    }
  }
}
