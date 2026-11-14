import { exec } from 'node:child_process'
import { promisify } from 'node:util'

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { getShellEnv } from '@main/utils/shellEnv'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { SubscriptionQuotaResult, SubscriptionQuotaWindow } from '@shared/ipc/schemas/provider'

const execAsync = promisify(exec)
const logger = loggerService.withContext('SubscriptionQuotaService')

export interface GetSubscriptionQuotaInput {
  providerId: string
  method?: 'auto' | 'http' | 'cli'
  cliCommand?: string
  httpUrl?: string
}

const KNOWN_CLI_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  'claude-code': 'claude /usage',
  [OPENAI_CODEX_PROVIDER_ID]: 'codex /usage',
  minimax: 'mcode /usage',
  'minimax-global': 'mcode /usage'
})

export function parseCliUsageOutput(output: string): {
  fiveHour?: SubscriptionQuotaWindow
  sevenDay?: SubscriptionQuotaWindow
  resets?: {
    totalCount?: number
    usedCount?: number
    remainingCount?: number
    resetInterval?: string
    nextResetAt?: string
  }
} {
  const result: ReturnType<typeof parseCliUsageOutput> = {}

  // 1. 5-hour limit matching:
  // e.g. "5-hour limit: 42% used", "5h limit: 42%", "42% of 5-hour limit used"
  const fiveHourPercentMatch =
    output.match(/(?:5[\s-]*hour|5h)\s*(?:limit|window|quota|usage)?[^\d%]*(\d+(?:\.\d+)?)\s*%/i) ||
    output.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:5[\s-]*hour|5h)/i) ||
    output.match(/5\s*小时[^\d%]*(\d+(?:\.\d+)?)\s*%/i)

  const fiveHourResetMatch =
    output.match(/(?:5[\s-]*hour|5h)[^\n]*?resets?\s+(?:in|at)\s+([^\n,.;)]+)/i) ||
    output.match(/resets?\s+(?:in|at)\s+([^\n,.;)]+)/i) ||
    output.match(/5\s*小时[^\n]*?(?:重置倒计时|重置时间|重置|倒计时)[:：\s]*([^\n,.;)]+)/i)

  if (fiveHourPercentMatch) {
    const pct = parseFloat(fiveHourPercentMatch[1])
    result.fiveHour = {
      usedPercentage: Math.min(100, Math.max(0, pct)),
      resetsInFormatted: fiveHourResetMatch ? fiveHourResetMatch[1].trim() : undefined
    }
  }

  // 2. 7-day limit matching:
  // e.g. "7-day limit: 18% used", "Weekly limit: 25%", "7d limit: 18%"
  const sevenDayPercentMatch =
    output.match(/(?:7[\s-]*day|7d|weekly)\s*(?:limit|window|quota|usage)?[^\d%]*(\d+(?:\.\d+)?)\s*%/i) ||
    output.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:7[\s-]*day|7d|weekly)/i) ||
    output.match(/7\s*天[^\d%]*(\d+(?:\.\d+)?)\s*%/i)

  const sevenDayResetMatch =
    output.match(/(?:7[\s-]*day|7d|weekly)[^\n]*?resets?\s+(?:on|in|at)\s+([^\n,.;)]+)/i) ||
    output.match(/7\s*天[^\n]*?(?:重置周期|重置时间|重置|周期)[:：\s]*([^\n,.;)]+)/i)

  if (sevenDayPercentMatch) {
    const pct = parseFloat(sevenDayPercentMatch[1])
    result.sevenDay = {
      usedPercentage: Math.min(100, Math.max(0, pct)),
      resetsInFormatted: sevenDayResetMatch ? sevenDayResetMatch[1].trim() : undefined
    }
  }

  // 3. Resets matching:
  // e.g. "Resets remaining: 3", "3 resets left", "3/5 resets"
  const resetsRemainingMatch =
    output.match(/(?:resets?\s*remaining|resets?\s*left|剩余重置次数)[^\d]*(\d+)/i) ||
    output.match(/(\d+)\s*(?:resets?\s*remaining|次重置)/i) ||
    output.match(/(\d+)\/(\d+)\s*resets?/i)

  if (resetsRemainingMatch) {
    if (resetsRemainingMatch[2]) {
      result.resets = {
        remainingCount: parseInt(resetsRemainingMatch[1], 10),
        totalCount: parseInt(resetsRemainingMatch[2], 10),
        resetInterval: '5h'
      }
    } else {
      result.resets = {
        remainingCount: parseInt(resetsRemainingMatch[1], 10),
        resetInterval: '5h'
      }
    }
  } else if (result.fiveHour) {
    result.resets = {
      resetInterval: '5h'
    }
  }

  return result
}

export class SubscriptionQuotaService {
  async getSubscriptionQuota(input: GetSubscriptionQuotaInput): Promise<SubscriptionQuotaResult> {
    const { providerId } = input
    const provider = providerService.getByProviderId(providerId)
    const subConfig = provider?.settings?.subscription

    const effectiveMethod = input.method || subConfig?.method || 'auto'
    const customCliCommand = input.cliCommand || subConfig?.cliCommand
    const customHttpUrl = input.httpUrl || subConfig?.httpUrl

    logger.info('Querying subscription quota', {
      providerId,
      effectiveMethod,
      hasCli: !!customCliCommand,
      hasHttp: !!customHttpUrl
    })

    let cliResult: SubscriptionQuotaResult | undefined

    // Try CLI if requested or auto
    if (effectiveMethod === 'cli' || effectiveMethod === 'auto') {
      cliResult = await this.tryFetchViaCli(providerId, customCliCommand)
      if (cliResult.success) {
        return cliResult
      }
      if (effectiveMethod === 'cli') {
        return cliResult
      }
    }

    let httpResult: SubscriptionQuotaResult | undefined

    // Try HTTP if requested or auto fallback
    if (effectiveMethod === 'http' || effectiveMethod === 'auto') {
      httpResult = await this.tryFetchViaHttp(providerId, customHttpUrl)
      if (httpResult.success) {
        return httpResult
      }
      if (effectiveMethod === 'http') {
        return httpResult
      }
    }

    return {
      providerId,
      success: false,
      source: 'auto',
      error: cliResult?.error || httpResult?.error || 'Unable to retrieve quota for this provider',
      updatedAt: new Date().toISOString()
    }
  }

  private async tryFetchViaCli(providerId: string, customCommand?: string): Promise<SubscriptionQuotaResult> {
    const trimmedCustom = customCommand?.trim()
    const command = trimmedCustom || KNOWN_CLI_COMMANDS[providerId]

    if (!command) {
      return {
        providerId,
        success: false,
        source: 'cli',
        error: 'No default CLI command configured for this provider',
        updatedAt: new Date().toISOString()
      }
    }

    try {
      const shellEnv = await getShellEnv()
      const { stdout, stderr } = await execAsync(command, {
        timeout: 6000,
        env: { ...process.env, ...shellEnv }
      })
      const fullText = `${stdout}\n${stderr}`.trim()
      const parsed = parseCliUsageOutput(fullText)

      const hasMetrics = parsed.fiveHour !== undefined || parsed.sevenDay !== undefined || parsed.resets !== undefined

      if (!hasMetrics) {
        return {
          providerId,
          success: false,
          source: 'cli',
          error: 'Failed to extract quota metrics from CLI output',
          rawOutput: fullText.slice(0, 1000),
          updatedAt: new Date().toISOString()
        }
      }

      return {
        providerId,
        success: true,
        source: 'cli',
        fiveHour: parsed.fiveHour,
        sevenDay: parsed.sevenDay,
        resets: parsed.resets,
        rawOutput: fullText.slice(0, 1000),
        updatedAt: new Date().toISOString()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`CLI usage query failed for ${providerId}: ${message}`)
      return {
        providerId,
        success: false,
        source: 'cli',
        error: `CLI execution failed: ${message.slice(0, 150)}`,
        updatedAt: new Date().toISOString()
      }
    }
  }

  private async tryFetchViaHttp(providerId: string, customUrl?: string): Promise<SubscriptionQuotaResult> {
    const trimmedUrl = customUrl?.trim()
    if (!trimmedUrl) {
      return {
        providerId,
        success: false,
        source: 'http',
        error: 'No HTTP endpoint configured for quota retrieval',
        updatedAt: new Date().toISOString()
      }
    }

    try {
      const response = await fetch(trimmedUrl, { method: 'GET', signal: AbortSignal.timeout(5000) })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const json = await response.json()
      if (json && (json.fiveHour || json.sevenDay || json.resets)) {
        return {
          providerId,
          success: true,
          source: 'http',
          fiveHour: json.fiveHour,
          sevenDay: json.sevenDay,
          resets: json.resets,
          updatedAt: new Date().toISOString()
        }
      }

      return {
        providerId,
        success: false,
        source: 'http',
        error: 'HTTP response did not contain quota information',
        updatedAt: new Date().toISOString()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`HTTP quota query failed for ${providerId}: ${message}`)
      return {
        providerId,
        success: false,
        source: 'http',
        error: `HTTP request failed: ${message.slice(0, 150)}`,
        updatedAt: new Date().toISOString()
      }
    }
  }
}

export const subscriptionQuotaService = new SubscriptionQuotaService()
