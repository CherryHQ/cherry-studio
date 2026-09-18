// A key can die between two conversations — revoked, or out of credit — and nothing notices until
// the user sends a message and gets an error back. This spends a request now and then to find out
// first. Deliberately frugal: the whole point of this fork is that requests are scarce.

import { application } from '@application'
import { loggerService } from '@logger'
import { recordModelHealth } from '@main/ai/runtime/aiSdk'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isProviderQuotaExhausted } from '@main/data/services/apiKeyQuota'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ProviderKeyScanService')

/** How often to consider scanning. Most ticks do nothing — see {@link STALE_AFTER_MS}. */
const TICK_MS = 30 * 60 * 1000

/** Ordinary traffic already records health, so only silence this long is worth a request. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000

/**
 * One provider per tick. Sweeping every provider at once would turn a quiet morning into a
 * visible dent in a 50-requests-a-day free tier.
 */
const PROVIDERS_PER_TICK = 1

const PROBE_TIMEOUT_MS = 15_000

@Injectable('ProviderKeyScanService')
@ServicePhase(Phase.WhenReady)
export class ProviderKeyScanService extends BaseService {
  protected async onReady(): Promise<void> {
    this.registerInterval(() => void this.tick(), TICK_MS)
  }

  /** Probe the stalest eligible provider, or do nothing. Exposed for tests. */
  async tick(): Promise<void> {
    try {
      if (!application.get('PreferenceService').get('chat.retry.background_scan_enabled')) return

      const candidates = this.staleCandidates()
      for (const { model } of candidates.slice(0, PROVIDERS_PER_TICK)) {
        await this.probe(model)
      }
    } catch (error) {
      // A background nicety must never take the app down with it.
      logger.warn('background key scan failed', { error })
    }
  }

  private async probe(model: Model): Promise<void> {
    try {
      const { latency } = await application.get('AiService').checkModel({
        uniqueModelId: model.id,
        timeout: PROBE_TIMEOUT_MS
      })
      await recordModelHealth(model.id, true, latency)
      logger.debug('background probe succeeded', { modelId: model.id, latency })
    } catch (error) {
      // The failure IS the result: the model picker dims a model whose health says `ok: false`.
      await recordModelHealth(model.id, false)
      logger.info('background probe failed, model marked unhealthy', { modelId: model.id, error })
    }
  }

  /**
   * One probe target per provider that has gone quiet, stalest first.
   *
   * Skipped: providers with no usable key (nothing to test), and providers already out of quota
   * (a probe would spend the last request the user was saving).
   */
  private staleCandidates(): Array<{ model: Model; checkedAt: number }> {
    const health = application.get('PreferenceService').get('chat.retry.model_health')
    const cutoff = Date.now() - STALE_AFTER_MS

    return providerService
      .list({ enabled: true })
      .filter((provider) => hasUsableKey(provider) && !isProviderQuotaExhausted(provider.id, provider.apiKeys))
      .flatMap((provider) => {
        const models = modelService.list({ enabled: true }).filter((model) => model.providerId === provider.id)
        if (models.length === 0) return []

        // A provider is fresh if ANY of its models answered recently — one live key is proof
        // enough that the account still works.
        const newest = models.reduce((latest, model) => Math.max(latest, health[model.id]?.checkedAt ?? 0), 0)
        if (newest > cutoff) return []

        // Probe the one that has been quiet longest, so repeated ticks spread across the list.
        const target = models.reduce((stalest, model) =>
          (health[model.id]?.checkedAt ?? 0) < (health[stalest.id]?.checkedAt ?? 0) ? model : stalest
        )
        return [{ model: target, checkedAt: newest }]
      })
      .sort((a, b) => a.checkedAt - b.checkedAt)
  }
}

function hasUsableKey(provider: Provider): boolean {
  return provider.apiKeys.some((key) => key.isEnabled)
}
