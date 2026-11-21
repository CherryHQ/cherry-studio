import { randomUUID } from 'node:crypto'

import { Mutex } from 'async-mutex'

import { application } from '@application'
import { PreferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { fetchRemoteText } from '@main/utils/remoteFetch'
import type { WebSearchBlacklistSubscription } from '@shared/data/preference/preferenceTypes'
import {
  DEFAULT_MAX_SUBSCRIPTION_RULES,
  isValidSubscriptionUrl,
  parseUBlacklistSubscription
} from '@shared/utils/blacklistSubscription'

const logger = loggerService.withContext('BlacklistSubscriptionService')

const PREFERENCE_KEY = 'chat.web_search.blacklist_subscriptions' as const
const FETCH_TIMEOUT_MS = 15000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

type PreferenceAccessor = Pick<PreferenceService, 'get' | 'set'>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns the uBlacklist subscription sources of the web search blacklist. The
 * list lives in the `chat.web_search.blacklist_subscriptions` preference with
 * the parsed rules cached next to each source, so filtering keeps working
 * offline. A failed refresh keeps the last successful rules and records
 * `lastError` on the source.
 */
@Injectable('BlacklistSubscriptionService')
@ServicePhase(Phase.WhenReady)
export class BlacklistSubscriptionService extends BaseService {
  private readonly mutationLock = new Mutex()
  protected async onInit(): Promise<void> {
    this.registerInterval(() => {
      void this.refreshAll().catch((error) => {
        logger.warn('Periodic blacklist subscription refresh failed', { error: errorMessage(error) })
      })
    }, REFRESH_INTERVAL_MS)
  }

  private get preferences(): PreferenceAccessor {
    return application.get('PreferenceService')
  }

  private getSubscriptions(): WebSearchBlacklistSubscription[] {
    return this.preferences.get(PREFERENCE_KEY)
  }

  private async setSubscriptions(subscriptions: WebSearchBlacklistSubscription[]): Promise<void> {
    await this.preferences.set(PREFERENCE_KEY, subscriptions)
  }

  /**
   * Adds a subscription: the URL must be HTTP(S), is fetched immediately, and
   * the parsed rule count comes back with the stored entry. Invalid URLs are
   * rejected before anything is stored.
   */
  async add(url: string, name?: string): Promise<WebSearchBlacklistSubscription> {
    return this.mutationLock.runExclusive(() => this.addLocked(url, name))
  }

  private async addLocked(url: string, name?: string): Promise<WebSearchBlacklistSubscription> {
    const trimmedUrl = url.trim()
    if (!isValidSubscriptionUrl(trimmedUrl)) {
      throw new Error(`Invalid subscription URL: only HTTP(S) URLs are supported`)
    }
    if (this.getSubscriptions().some((subscription) => subscription.url === trimmedUrl)) {
      throw new Error(`Subscription already exists: ${trimmedUrl}`)
    }

    const { rules, droppedCount } = await this.fetchRules(trimmedUrl)
    const subscription: WebSearchBlacklistSubscription = {
      id: randomUUID(),
      url: trimmedUrl,
      name: name?.trim() || undefined,
      rules,
      updatedAt: new Date().toISOString()
    }
    if (droppedCount > 0) {
      logger.info('Subscription contained invalid lines', { url: trimmedUrl, droppedCount })
    }

    await this.setSubscriptions([...this.getSubscriptions(), subscription])
    return subscription
  }

  /**
   * Re-fetches one subscription. On success the cached rules and `updatedAt`
   * are replaced; on failure the previous rules stay and `lastError` is set.
   */
  async refresh(id: string): Promise<WebSearchBlacklistSubscription> {
    return this.mutationLock.runExclusive(() => this.refreshLocked(id))
  }

  private async refreshLocked(id: string): Promise<WebSearchBlacklistSubscription> {
    const subscriptions = this.getSubscriptions()
    const index = subscriptions.findIndex((subscription) => subscription.id === id)
    if (index === -1) {
      throw new Error(`Unknown blacklist subscription: ${id}`)
    }

    const current = subscriptions[index]
    let next: WebSearchBlacklistSubscription
    try {
      const { rules, droppedCount } = await this.fetchRules(current.url)
      if (droppedCount > 0) {
        logger.info('Subscription contained invalid lines', { url: current.url, droppedCount })
      }
      next = { ...current, rules, updatedAt: new Date().toISOString(), lastError: undefined }
    } catch (error) {
      logger.warn('Blacklist subscription refresh failed', { url: current.url, error: errorMessage(error) })
      next = { ...current, lastError: errorMessage(error) }
    }

    const updated = [...subscriptions]
    updated[index] = next
    await this.setSubscriptions(updated)
    return next
  }

  async refreshAll(): Promise<void> {
    for (const subscription of this.getSubscriptions()) {
      await this.refresh(subscription.id)
    }
  }

  /** Removes a subscription; its rules drop out of the effective blacklist. */
  async remove(id: string): Promise<void> {
    await this.mutationLock.runExclusive(() =>
      this.setSubscriptions(this.getSubscriptions().filter((subscription) => subscription.id !== id))
    )
  }

  private async fetchRules(url: string): Promise<{ rules: string[]; droppedCount: number }> {
    const body = await fetchRemoteText(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES
    })
    return parseUBlacklistSubscription(body, { maxRules: DEFAULT_MAX_SUBSCRIPTION_RULES })
  }
}
