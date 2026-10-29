import { eq } from 'drizzle-orm'
import { app, Notification as ElectronNotification } from 'electron'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { type CreateNotificationRecordInput, notificationRecordService } from '@data/services/NotificationRecordService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import type { ConversationCompletedEvent, ConversationUnsuccessfulEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { NotificationTaskResultSchema, type TaskResultNotificationInput } from '@shared/data/types/notification'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import {
  CONVERSATION_NOTIFICATION_ACTION_KEY,
  type ConversationNotification,
  type Notification,
  type NotificationSource
} from '@shared/types/notification'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

import { openNotificationInMainWindow, openRouteInMainWindow } from './mainWindowNavigation'

const logger = loggerService.withContext('NotificationService')
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

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
  private completedBudgetPeriod?: string

  protected onInit(): void {
    this.registerDisposable(
      application.get('AiStreamManager').onConversationCompleted((event) => this.handleConversationCompleted(event))
    )
    this.registerDisposable(
      application
        .get('AiStreamManager')
        .onConversationUnsuccessful((event) => this.handleConversationUnsuccessful(event))
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
    this.registerDisposable(aiUsageRecordService.onInvocationsRecorded(() => this.refreshDailyBudget()))
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges(
          ['app.notification.daily_budget.tokens', 'app.notification.daily_budget.threshold'],
          (_key, value, previous) => {
            if (value === previous) return
            try {
              this.writeState('notification:daily-budget-cycle', crypto.randomUUID())
            } catch (error) {
              logger.warn('Failed to reset daily budget notification', { error })
            }
          }
        )
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
    options: { source?: NotificationSource; completion?: boolean; recordOnly?: boolean } = {}
  ): Promise<boolean> {
    let committed = false
    try {
      const preferences = application.get('PreferenceService')
      const enabled = preferences.get(`app.notification.center.${input.category}.enabled`)
      const result = input.target?.result
      const completion = input.kind === 'task-completion' || input.kind === 'queue-completion'
      const active =
        enabled &&
        (completion || !!result) &&
        input.target?.kind === 'conversation' &&
        getFullChromeWindowInfos().some((window) => window.isFocused) &&
        (await application.get('ConversationNavigationService').isActiveInFocusedWindow(input.target))
      const suppressed = !enabled || (active && (completion || result?.status === 'succeeded'))
      const recordOnly = options.recordOnly || result?.status === 'cancelled' || (!!result && active)
      const initial = {
        ...input,
        readAt: result && recordOnly ? Date.now() : input.readAt
      }
      const record = result
        ? notificationRecordService.consumeTaskResult(input.eventKey, suppressed ? null : initial)
        : suppressed
          ? null
          : notificationRecordService.create(initial)
      if (!record) return true
      committed = true
      if (recordOnly) return true
      const windows = getFullChromeWindowInfos()
      const focused = windows.find((window) => window.isFocused)
      const owner = focused ?? windows.find((window) => window.type === WindowType.Main) ?? windows[0]
      let sound = false
      if (options.completion && preferences.get('app.notification.completion_sound.enabled') && owner) {
        try {
          application.get('IpcApiService').send(owner.id, 'notification.completion_sound', { id: record.id })
          sound = true
        } catch (error) {
          logger.warn('Failed to play completion sound', { error })
        }
      }
      if (focused) {
        if (options.completion || result || input.category === 'usage') {
          application.get('IpcApiService').send(focused.id, 'notification.present', record)
        }
        if (options.source !== 'update' && options.source !== 'backup') return true
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

  /** Persists an authoritative outcome through the existing notification delivery policy. */
  public async publishTaskResult(input: TaskResultNotificationInput): Promise<boolean> {
    try {
      if (!input.resultId.trim() || !Number.isSafeInteger(input.finishedAt) || input.finishedAt < 0) return false
      const result = NotificationTaskResultSchema.parse(input)
      if (result.errorSummary) {
        result.errorSummary = Array.from(redactSecretTokens(redactSecretText(result.errorSummary)))
          .slice(0, 500)
          .join('')
      }
      return this.publish(
        {
          eventKey: `task-result:${JSON.stringify([result.source, input.resultId])}`,
          category: 'system',
          kind: 'task-result',
          title: {
            succeeded: t('notification.result.succeeded'),
            failed: t('notification.result.failed'),
            interrupted: t('notification.result.interrupted'),
            cancelled: t('notification.result.cancelled')
          }[result.status],
          message: result.errorSummary ? `${result.name}: ${result.errorSummary}` : result.name,
          createdAt: input.finishedAt,
          target: { ...input.target, result }
        },
        { source: 'assistant', completion: result.status === 'succeeded' }
      )
    } catch (error) {
      logger.warn('Invalid task result notification', { error })
      return false
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
        .focusOrOpen(conversation, this.resolveConversationName(target), null, target.messageId)
    } else if (target.kind === 'scheduled-task') {
      try {
        if (!agentTaskService.getTaskById(target.taskId)) throw new Error('Deleted task')
      } catch {
        throw new Error(t('notification.center.target_unavailable'))
      }
      openRouteInMainWindow(
        `/settings/scheduled-tasks/${encodeURIComponent(target.taskId)}?notificationId=${encodeURIComponent(id)}`
      )
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

  private refreshDailyBudget(): void {
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
      )
        return
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1
      const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
      const cycle = this.readState<string>('notification:daily-budget-cycle')
      const period = cycle ? `${day}:${cycle}` : day
      if (this.completedBudgetPeriod === period) return
      const total = aiUsageRecordService.stats({ from, to, groupBy: 'model', metric: 'tokens', limit: 1 }).totals
        .totalTokens
      const limit = (budget * threshold) / 100
      if (total < limit) return
      void this.publish({
        eventKey: `daily-budget:${period}`,
        category: 'usage',
        kind: 'daily-budget',
        createdAt: Date.now(),
        title: t('notification.center.budget_title'),
        message: t('notification.center.budget_message', {
          percent: Math.round((total / budget) * 100),
          used: `${total / 1000}k`,
          budget: `${budget / 1000}k`
        }),
        target: { kind: 'settings', tab: 'usage' }
      }).then((recorded) => {
        if (recorded) this.completedBudgetPeriod = period
      })
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

  public async publishScheduledTaskResult(jobId: string): Promise<boolean> {
    const job = jobService.getById(jobId)
    if (!job?.scheduleId || !job.finishedAt || (job.status !== 'failed' && job.status !== 'cancelled')) return false
    const schedule = jobScheduleService.getById(job.scheduleId)
    if (!schedule) return false
    const finishedAt = Date.parse(job.finishedAt)
    return this.publishTaskResult({
      resultId: job.id,
      source: 'scheduled-task',
      status:
        job.metadata.taskResultStatus === 'cancelled' || job.metadata.taskResultStatus === 'interrupted'
          ? job.metadata.taskResultStatus
          : job.status === 'failed'
            ? 'failed'
            : job.cancelRequested
              ? 'cancelled'
              : 'interrupted',
      name: schedule.name || t('notification.result.failed'),
      finishedAt,
      ...(job.startedAt ? { durationMs: Math.max(0, finishedAt - Date.parse(job.startedAt)) } : {}),
      ...(job.error
        ? { errorSummary: toExecutionFailure({ name: null, stack: null, message: job.error.message }).message }
        : {}),
      target: { kind: 'scheduled-task', taskId: job.scheduleId }
    })
  }

  private handleConversationUnsuccessful(event: ConversationUnsuccessfulEvent): void {
    const target = this.resolveConversationTarget(event.topicId)
    void this.publishTaskResult({
      ...event,
      source: target.conversationType,
      name: this.resolveConversationName(
        target,
        target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
      ),
      target: { kind: 'conversation', ...target, messageId: event.messageId }
    })
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
