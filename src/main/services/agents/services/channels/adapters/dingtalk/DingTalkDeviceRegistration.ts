/**
 * DingTalk Device Authorization Grant flow.
 *
 * Ported from @soimy/openclaw-channel-dingtalk `src/device-registration.ts`.
 * Three endpoints on `oapi.dingtalk.com`:
 *   1. POST /app/registration/init  -> { nonce }
 *   2. POST /app/registration/begin -> { device_code, verification_uri_complete, expires_in, interval }
 *   3. POST /app/registration/poll  -> { status: WAITING|SUCCESS|FAIL|EXPIRED, client_id?, client_secret? }
 */
import { loggerService } from '@logger'
import { net } from 'electron'

const logger = loggerService.withContext('DingTalkDeviceRegistration')

const REGISTRATION_BASE_URL = 'https://oapi.dingtalk.com'
const REGISTRATION_SOURCE = 'CherryStudio'

/** Window during which transient errors are retried before giving up. */
const RETRY_WINDOW_MS = 120_000

export interface DingTalkBeginResult {
  deviceCode: string
  /** URL to render as a QR code; users scan it with DingTalk to authorize. */
  verificationUrl: string
  expiresIn: number
  interval: number
}

export interface DingTalkRegistrationResult {
  clientId: string
  clientSecret: string
}

type PollStatus = 'WAITING' | 'SUCCESS' | 'FAIL' | 'EXPIRED'

async function apiPost(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${REGISTRATION_BASE_URL}${path}`
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    throw new Error(`DingTalk registration HTTP ${res.status} for ${path}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const errcode = data.errcode
  if (errcode !== undefined && errcode !== 0) {
    const errmsg = typeof data.errmsg === 'string' ? data.errmsg : 'unknown error'
    throw new Error(`DingTalk registration error [${path}]: ${errmsg} (errcode=${String(errcode)})`)
  }
  return data
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export async function registrationBegin(): Promise<DingTalkBeginResult> {
  const initData = await apiPost('/app/registration/init', { source: REGISTRATION_SOURCE })
  const nonce = asString(initData.nonce).trim()
  if (!nonce) throw new Error('DingTalk registration init: missing nonce')

  const beginData = await apiPost('/app/registration/begin', { nonce })
  const deviceCode = asString(beginData.device_code).trim()
  const verificationUrl = asString(beginData.verification_uri_complete).trim()
  if (!deviceCode) throw new Error('DingTalk registration begin: missing device_code')
  if (!verificationUrl) throw new Error('DingTalk registration begin: missing verification_uri_complete')

  const expiresIn = Number(beginData.expires_in ?? 7200) || 7200
  const interval = Math.max(Number(beginData.interval ?? 3) || 3, 2)

  logger.info('DingTalk QR generated', { expiresIn, interval })
  return { deviceCode, verificationUrl, expiresIn, interval }
}

export async function registrationPoll(
  begin: DingTalkBeginResult,
  signal?: AbortSignal
): Promise<DingTalkRegistrationResult> {
  const deadline = Date.now() + begin.expiresIn * 1000
  const intervalMs = begin.interval * 1000
  let networkRetryStart = 0
  let statusRetryStart = 0

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('DingTalk registration cancelled')

    await sleep(intervalMs, signal)
    if (signal?.aborted) throw new Error('DingTalk registration cancelled')

    let data: Record<string, unknown>
    try {
      data = await apiPost('/app/registration/poll', { device_code: begin.deviceCode })
    } catch (err) {
      if (!networkRetryStart) networkRetryStart = Date.now()
      if (Date.now() - networkRetryStart < RETRY_WINDOW_MS) {
        logger.warn('DingTalk poll network error, retrying', {
          error: err instanceof Error ? err.message : String(err)
        })
        continue
      }
      throw new Error('DingTalk registration polling failed after retry window')
    }
    networkRetryStart = 0

    const status = asString(data.status).trim().toUpperCase() as PollStatus

    if (status === 'WAITING') {
      statusRetryStart = 0
      continue
    }
    if (status === 'SUCCESS') {
      const clientId = asString(data.client_id).trim()
      const clientSecret = asString(data.client_secret).trim()
      if (!clientId || !clientSecret) {
        throw new Error('DingTalk authorization succeeded but credentials missing')
      }
      logger.info('DingTalk registration completed')
      return { clientId, clientSecret }
    }
    if (status === 'EXPIRED') {
      throw new Error('DingTalk authorization expired')
    }
    // FAIL — retry within window
    if (!statusRetryStart) statusRetryStart = Date.now()
    if (Date.now() - statusRetryStart < RETRY_WINDOW_MS) continue
    throw new Error(`DingTalk authorization failed: ${asString(data.fail_reason) || status}`)
  }

  throw new Error('DingTalk authorization timed out')
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
