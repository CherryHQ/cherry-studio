// Keeps the per-category model ranking current so adding or removing an API key is the only step:
// no category mapping to fill in, no health check to remember to run.

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isProviderQuotaExhausted } from '@main/data/services/apiKeyQuota'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { TaskCategory } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import { type DerivedRoutingTable, EMPTY_DERIVED_ROUTING_TABLE } from '@shared/data/types/routing'

import { deriveRoutingTable, type RoutableModel } from './deriveRoutingTable'

const logger = loggerService.withContext('ModelRoutingService')

/** Collapses the burst of preference writes a health check produces into one rebuild. */
const REBUILD_DEBOUNCE_MS = 2_000

/**
 * Provider and model writes emit no event, so a key being pasted can only be noticed by looking.
 * Slow enough to stay invisible in a profile, fast enough that the user does not sit and wait.
 */
const FINGERPRINT_POLL_MS = 60_000

@Injectable('ModelRoutingService')
@ServicePhase(Phase.WhenReady)
export class ModelRoutingService extends BaseService {
  private table: DerivedRoutingTable = EMPTY_DERIVED_ROUTING_TABLE
  private fingerprint = ''
  private rebuildTimer: NodeJS.Timeout | null = null

  protected async onReady(): Promise<void> {
    const preferences = application.get('PreferenceService')

    // Health arrives from ordinary traffic — every chat request already records its outcome — so
    // the ranking sharpens as the app is used, with no probe of our own and no extra model call.
    this.registerDisposable(preferences.subscribeChange('chat.retry.model_health', () => this.scheduleRebuild()))
    this.registerDisposable(preferences.subscribeChange('chat.routing.api_key_limits', () => this.scheduleRebuild()))

    this.registerInterval(() => this.rebuildIfSourcesChanged(), FINGERPRINT_POLL_MS)
    this.registerDisposable(() => this.cancelScheduledRebuild())

    this.rebuild()
  }

  /** Ranked models for a category, best first. Empty when nothing is available yet. */
  candidatesFor(category: TaskCategory): UniqueModelId[] {
    return this.table[category].map((candidate) => candidate.id)
  }

  private cancelScheduledRebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.rebuildTimer = null
  }

  private scheduleRebuild(): void {
    this.cancelScheduledRebuild()
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      this.rebuild()
    }, REBUILD_DEBOUNCE_MS)
    this.rebuildTimer.unref()
  }

  /** Enabled models whose provider is also switched on, with that provider's quota standing. */
  private collectSources(): { models: RoutableModel[]; exhaustedProviderIds: Set<string> } {
    const enabledProviders = providerService.list({ enabled: true })
    const exhaustedProviderIds = new Set(
      // Provider-wide on purpose: the table ranks providers, and a model-scoped ceiling only
      // describes one of their models. The per-request paths apply that finer check themselves.
      enabledProviders.filter((provider) => isProviderQuotaExhausted(provider.id, provider.apiKeys)).map((p) => p.id)
    )
    const enabledProviderIds = new Set(enabledProviders.map((provider) => provider.id))

    const models = modelService
      .list({ enabled: true })
      .filter((model) => enabledProviderIds.has(model.providerId))
      .map((model) => ({
        id: model.id,
        providerId: model.providerId,
        capabilities: model.capabilities,
        outputModalities: model.outputModalities
      }))

    return { models, exhaustedProviderIds }
  }

  private rebuild(): void {
    try {
      const { models, exhaustedProviderIds } = this.collectSources()
      this.fingerprint = fingerprintOf(models, exhaustedProviderIds)
      this.table = deriveRoutingTable({
        models,
        health: application.get('PreferenceService').get('chat.retry.model_health'),
        exhaustedProviderIds
      })

      // Main owns this value; the renderer reads it to explain why a model was picked.
      application.get('CacheService').setShared('routing.derived_table', this.table)
      logger.debug('rebuilt routing table', { modelCount: models.length })
    } catch (error) {
      // Routing is an optimisation. Keeping the previous table beats clearing it and sending every
      // request to a default that may itself be broken.
      logger.warn('failed to rebuild the routing table, keeping the previous one', { error })
    }
  }

  private rebuildIfSourcesChanged(): void {
    try {
      const { models, exhaustedProviderIds } = this.collectSources()
      if (fingerprintOf(models, exhaustedProviderIds) !== this.fingerprint) this.rebuild()
    } catch (error) {
      logger.warn('failed to check for provider changes', { error })
    }
  }
}

/** Identity of the inputs, so the poll can skip the ranking when nothing moved. */
function fingerprintOf(models: readonly RoutableModel[], exhaustedProviderIds: ReadonlySet<string>): string {
  return [
    models
      .map((model) => model.id)
      .sort()
      .join(','),
    [...exhaustedProviderIds].sort().join(',')
  ].join('|')
}
