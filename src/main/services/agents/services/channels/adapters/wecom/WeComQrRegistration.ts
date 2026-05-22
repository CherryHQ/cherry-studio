/**
 * WeCom QR-based smart bot registration.
 *
 * Ported from wecom-cli `src/auth/qrcode.rs`. The flow is:
 *   1. POST /ai/qc/generate  -> { scode, auth_url }
 *   2. Render `auth_url` as a QR (user scans with the WeCom mobile app)
 *   3. Poll /ai/qc/query_result?scode=<scode> every 3 s until
 *      data.status === 'success', then read data.bot_info.{botid,secret}.
 *   4. Timeout after 5 min.
 */
import { loggerService } from '@logger'
import { net } from 'electron'

import { QrGenerateResponseSchema, QrQueryResponseSchema } from './WeComSchemas'

const logger = loggerService.withContext('WeComQrRegistration')

const SOURCE = 'wecom_cli_external'
const QR_GENERATE_URL = 'https://work.weixin.qq.com/ai/qc/generate'
const QR_QUERY_URL = 'https://work.weixin.qq.com/ai/qc/query_result'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 5 * 60_000

export interface WeComQrBeginResult {
  scode: string
  /** The encoded URL to render inside a QR code; users scan it with WeCom. */
  authUrl: string
}

export interface WeComQrPollResult {
  botId: string
  botSecret: string
}

/** Map `process.platform` to the `plat` value the upstream server expects. */
function getPlatCode(): number {
  switch (process.platform) {
    case 'darwin':
      return 1
    case 'win32':
      return 2
    case 'linux':
      return 3
    default:
      return 0
  }
}

export async function registrationBegin(): Promise<WeComQrBeginResult> {
  const url = `${QR_GENERATE_URL}?source=${encodeURIComponent(SOURCE)}&plat=${getPlatCode()}`
  const res = await net.fetch(url, { method: 'GET' })
  if (!res.ok) {
    throw new Error(`WeCom QR generate HTTP ${res.status}`)
  }
  const parsed = QrGenerateResponseSchema.safeParse(await res.json())
  if (!parsed.success) {
    throw new Error(`WeCom QR generate schema mismatch: ${parsed.error.message}`)
  }
  const scode = parsed.data.data?.scode
  const authUrl = parsed.data.data?.auth_url
  if (!scode || !authUrl) {
    throw new Error('WeCom QR generate response missing scode or auth_url')
  }
  logger.info('WeCom QR generated', { scode })
  return { scode, authUrl }
}

export async function registrationPoll(scode: string, signal?: AbortSignal): Promise<WeComQrPollResult> {
  const url = `${QR_QUERY_URL}?scode=${encodeURIComponent(scode)}`
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('WeCom QR polling aborted')

    await sleep(POLL_INTERVAL_MS, signal)
    if (signal?.aborted) throw new Error('WeCom QR polling aborted')

    const res = await net.fetch(url, { method: 'GET' })
    if (!res.ok) {
      logger.warn('WeCom QR poll non-OK status', { status: res.status })
      continue
    }
    const parsed = QrQueryResponseSchema.safeParse(await res.json())
    if (!parsed.success) {
      logger.warn('WeCom QR poll schema mismatch', { error: parsed.error.message })
      continue
    }
    const data = parsed.data.data
    if (data?.status === 'success') {
      const botId = data.bot_info?.botid
      const botSecret = data.bot_info?.secret
      if (!botId || !botSecret) {
        throw new Error('WeCom QR success but bot credentials missing in response')
      }
      logger.info('WeCom QR registration completed')
      return { botId, botSecret }
    }
  }

  throw new Error('WeCom QR registration timed out (5 minutes)')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true }
    )
  })
}
