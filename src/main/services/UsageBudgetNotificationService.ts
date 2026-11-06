import { eq } from 'drizzle-orm'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'

const logger = loggerService.withContext('UsageBudgetNotificationService')

@Injectable('UsageBudgetNotificationService')
@DependsOn(['NotificationService'])
@ServicePhase(Phase.WhenReady)
export class UsageBudgetNotificationService extends BaseService {
  private completedBudgetPeriod?: string

  protected onInit(): void {
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
      void application
        .get('NotificationService')
        .publish({
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
        })
        .then((recorded) => {
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
}
