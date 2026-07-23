import { loggerService } from '@logger'
import {
  CHERRYIN_HOSTS,
  type CherryInEndpointSelection,
  type CherryInHost,
  type CherryInHostMode,
  isCherryInHostMode
} from '@shared/config/cherryin'
import { net } from 'electron'

import { configManager } from './ConfigManager'
import { reduxService } from './ReduxService'

const logger = loggerService.withContext('CherryINEndpointService')

const HOST_MODE_CONFIG_KEY = 'cherryIn.hostMode'
const PROBE_PATH = '/livez'
const PROBE_ROUNDS = 2
const PROBE_TIMEOUT_MS = 1500
const PROVIDER_SYNC_MAX_ATTEMPTS = 3
const PROVIDER_SYNC_RETRY_DELAY_MS = 3000

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
    return {
      host: china.successCount > global.successCount ? china.host : global.host,
      source: 'probe'
    }
  }

  const chinaLatency = median(china.latencies)
  const globalLatency = median(global.latencies)

  return {
    host: chinaLatency <= globalLatency ? china.host : global.host,
    source: 'probe'
  }
}

function median(values: number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY

  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export class CherryINEndpointService {
  private currentSelection: CherryInEndpointSelection | null = null
  private selectionPromise: Promise<CherryInEndpointSelection> | null = null
  private selectionRevision = 0

  public initialize(): Promise<CherryInEndpointSelection> {
    if (!this.selectionPromise) {
      this.selectionPromise = this.resolveConfiguredMode(++this.selectionRevision)
    }
    return this.selectionPromise
  }

  public async getSelection(): Promise<CherryInEndpointSelection> {
    return this.selectionPromise ?? this.initialize()
  }

  public setMode(mode: CherryInHostMode): Promise<CherryInEndpointSelection> {
    if (!isCherryInHostMode(mode)) {
      throw new Error(`Unsupported CherryIN host mode: ${String(mode)}`)
    }

    configManager.set(HOST_MODE_CONFIG_KEY, mode)
    const revision = ++this.selectionRevision
    this.selectionPromise = this.resolveMode(mode, revision)
    return this.selectionPromise
  }

  private async resolveConfiguredMode(revision: number): Promise<CherryInEndpointSelection> {
    const configuredMode = configManager.get<unknown>(HOST_MODE_CONFIG_KEY)
    if (isCherryInHostMode(configuredMode)) {
      return this.resolveMode(configuredMode, revision)
    }

    configManager.set(HOST_MODE_CONFIG_KEY, 'auto')
    return this.resolveMode('auto', revision)
  }

  private async resolveMode(mode: CherryInHostMode, revision: number): Promise<CherryInEndpointSelection> {
    let selection: CherryInEndpointSelection

    if (mode === 'auto') {
      selection = await this.probePreferredHost()
    } else {
      selection = {
        host: CHERRYIN_HOSTS[mode],
        mode,
        source: 'manual'
      }
    }

    if (revision !== this.selectionRevision) {
      return this.currentSelection ?? selection
    }

    this.applySelection(selection)
    return selection
  }

  private async probePreferredHost(): Promise<CherryInEndpointSelection> {
    const summaries: Record<keyof typeof CHERRYIN_HOSTS, ProbeSummary> = {
      china: { host: CHERRYIN_HOSTS.china, latencies: [], successCount: 0 },
      global: { host: CHERRYIN_HOSTS.global, latencies: [], successCount: 0 }
    }

    for (let round = 0; round < PROBE_ROUNDS; round++) {
      const [chinaLatency, globalLatency] = await Promise.all([
        this.probeHost(CHERRYIN_HOSTS.china, round),
        this.probeHost(CHERRYIN_HOSTS.global, round)
      ])

      if (chinaLatency !== null) {
        summaries.china.successCount++
        summaries.china.latencies.push(chinaLatency)
      }
      if (globalLatency !== null) {
        summaries.global.successCount++
        summaries.global.latencies.push(globalLatency)
      }
    }

    const result = choosePreferredCherryInHost(summaries.china, summaries.global)

    logger.info('Selected CherryIN host', {
      chinaLatencies: summaries.china.latencies,
      globalLatencies: summaries.global.latencies,
      host: result.host,
      source: result.source
    })

    return {
      host: result.host,
      mode: 'auto',
      source: result.source
    }
  }

  private async probeHost(host: CherryInHost, round: number): Promise<number | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const startedAt = performance.now()

    try {
      const url = `${host}${PROBE_PATH}`
      const response = await net.fetch(url, {
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      })

      if (!response.ok) return null

      const contentType = response.headers.get('content-type')
      if (!contentType?.toLowerCase().includes('application/json')) return null

      const body: unknown = await response.json()
      if (!isHealthyProbeResponse(body)) return null

      return performance.now() - startedAt
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
    this.syncProvider(selection, 1)
  }

  private syncProvider(selection: CherryInEndpointSelection, attempt: number): void {
    void reduxService
      .dispatch({
        type: 'llm/updateProvider',
        payload: {
          anthropicApiHost: selection.host,
          apiHost: selection.host,
          id: 'cherryin'
        }
      })
      .catch((error) => {
        if (this.currentSelection !== selection || attempt >= PROVIDER_SYNC_MAX_ATTEMPTS) {
          logger.warn('Failed to sync the selected CherryIN host to the provider', error as Error)
          return
        }

        setTimeout(() => {
          if (this.currentSelection === selection) {
            this.syncProvider(selection, attempt + 1)
          }
        }, PROVIDER_SYNC_RETRY_DELAY_MS)
      })
  }
}

function isHealthyProbeResponse(value: unknown): value is { status: 'ok' } {
  return typeof value === 'object' && value !== null && 'status' in value && value.status === 'ok'
}

export const cherryInEndpointService = new CherryINEndpointService()
