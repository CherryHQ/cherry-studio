import { application } from '@application'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  CHERRYIN_HOSTS,
  type CherryInEndpointSelection,
  type CherryInHost,
  type CherryInHostMode,
  isCherryInHostMode
} from '@shared/utils/cherryin'
import { net } from 'electron'

const logger = loggerService.withContext('CherryInEndpointService')
const PROBE_PATH = '/livez'
const PROBE_ROUNDS = 2
const PROBE_TIMEOUT_MS = 1500

interface ProbeSummary {
  host: CherryInHost
  latencies: number[]
  successCount: number
}

export function choosePreferredCherryInHost(
  china: ProbeSummary,
  global: ProbeSummary
): { host: CherryInHost; source: 'fallback' | 'probe' } {
  if (china.successCount === 0 && global.successCount === 0) {
    return { host: CHERRYIN_HOSTS.china, source: 'fallback' }
  }
  if (china.successCount !== global.successCount) {
    return { host: china.successCount > global.successCount ? china.host : global.host, source: 'probe' }
  }
  return {
    host: median(china.latencies) <= median(global.latencies) ? china.host : global.host,
    source: 'probe'
  }
}

function median(values: number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

@Injectable('CherryInEndpointService')
@ServicePhase(Phase.WhenReady)
export class CherryInEndpointService extends BaseService {
  private currentSelection: CherryInEndpointSelection | null = null
  private selectionPromise: Promise<CherryInEndpointSelection> | null = null
  private selectionRevision = 0

  protected override onReady(): void {
    try {
      if (providerService.getByProviderId('cherryin').isEnabled) {
        void this.initialize().catch((error) => logger.warn('Failed to prewarm CherryIN endpoint', error as Error))
      }
    } catch (error) {
      logger.warn('Failed to read CherryIN provider', error as Error)
    }
  }

  protected override onStop(): void {
    this.selectionRevision++
    this.currentSelection = null
    this.selectionPromise = null
  }

  public initialize(): Promise<CherryInEndpointSelection> {
    if (!this.selectionPromise) {
      this.selectionPromise = this.resolveConfiguredMode(++this.selectionRevision)
    }
    return this.selectionPromise
  }

  public getSelection(): Promise<CherryInEndpointSelection> {
    return this.selectionPromise ?? this.initialize()
  }

  public setMode(mode: CherryInHostMode): Promise<CherryInEndpointSelection> {
    if (!isCherryInHostMode(mode)) {
      throw new Error(`Unsupported CherryIN host mode: ${String(mode)}`)
    }
    providerService.update('cherryin', { providerSettings: { cherryInHostMode: mode } })
    this.selectionPromise = this.resolveMode(mode, ++this.selectionRevision)
    return this.selectionPromise
  }

  private resolveConfiguredMode(revision: number): Promise<CherryInEndpointSelection> {
    const mode = providerService.getByProviderId('cherryin').settings.cherryInHostMode
    return this.resolveMode(isCherryInHostMode(mode) ? mode : 'auto', revision)
  }

  private async resolveMode(mode: CherryInHostMode, revision: number): Promise<CherryInEndpointSelection> {
    const selection =
      mode === 'auto'
        ? await this.probePreferredHost()
        : { host: CHERRYIN_HOSTS[mode], mode, source: 'manual' as const }

    if (revision !== this.selectionRevision) {
      return this.currentSelection ?? selection
    }
    this.applySelection(selection)
    return selection
  }

  private async probePreferredHost(): Promise<CherryInEndpointSelection> {
    const summaries: Record<'china' | 'global', ProbeSummary> = {
      china: { host: CHERRYIN_HOSTS.china, latencies: [], successCount: 0 },
      global: { host: CHERRYIN_HOSTS.global, latencies: [], successCount: 0 }
    }

    for (let round = 0; round < PROBE_ROUNDS; round++) {
      const results = await Promise.all([
        this.probeHost(CHERRYIN_HOSTS.china, round),
        this.probeHost(CHERRYIN_HOSTS.global, round)
      ])
      ;(['china', 'global'] as const).forEach((key, index) => {
        if (results[index] !== null) {
          summaries[key].successCount++
          summaries[key].latencies.push(results[index])
        }
      })
    }

    const result = choosePreferredCherryInHost(summaries.china, summaries.global)
    logger.info('Selected CherryIN host', {
      chinaLatencies: summaries.china.latencies,
      globalLatencies: summaries.global.latencies,
      host: result.host,
      source: result.source
    })
    return { ...result, mode: 'auto' }
  }

  private async probeHost(host: CherryInHost, round: number): Promise<number | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const startedAt = performance.now()
    try {
      const response = await net.fetch(`${host}${PROBE_PATH}`, {
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      })
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        return null
      }
      const body: unknown = await response.json()
      return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
        ? performance.now() - startedAt
        : null
    } catch (error) {
      logger.debug('CherryIN host probe failed', {
        error: error instanceof Error ? error.message : String(error),
        host,
        round
      })
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  private applySelection(selection: CherryInEndpointSelection): void {
    this.currentSelection = selection
    const provider = providerService.getByProviderId('cherryin')
    const endpointConfigs = Object.fromEntries(
      Object.entries(provider.endpointConfigs ?? {}).map(([type, config]) => [
        type,
        { ...config, baseUrl: selection.host }
      ])
    )
    providerService.update('cherryin', { endpointConfigs })
    application.get('IpcApiService').broadcast('cherryin.endpoint_selected', selection)
  }
}
