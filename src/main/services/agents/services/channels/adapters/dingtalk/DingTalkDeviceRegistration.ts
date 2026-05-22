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
import type * as z from 'zod'

import {
  DingTalkRegistrationBeginResponseSchema,
  DingTalkRegistrationInitResponseSchema,
  DingTalkRegistrationPollResponseSchema
} from './DingTalkSchemas'

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

async function apiPost<S extends z.ZodTypeAny>(
  path: string,
  payload: Record<string, unknown>,
  schema: S
): Promise<z.infer<S>> {
  const url = `${REGISTRATION_BASE_URL}${path}`
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    throw new Error(`DingTalk registration HTTP ${res.status} for ${path}`)
  }
  const parsed = schema.safeParse(await res.json())
  if (!parsed.success) {
    throw new Error(`DingTalk registration response schema mismatch [${path}]: ${parsed.error.message}`)
  }
  const data = parsed.data as { errcode?: number | string; errmsg?: string }
  if (data.errcode !== undefined && data.errcode !== 0 && data.errcode !== '0') {
    throw new Error(
      `DingTalk registration error [${path}]: ${data.errmsg ?? 'unknown error'} (errcode=${String(data.errcode)})`
    )
  }
  return parsed.data
}

export async function registrationBegin(): Promise<DingTalkBeginResult> {
  const initData = await apiPost(
    '/app/registration/init',
    { source: REGISTRATION_SOURCE },
    DingTalkRegistrationInitResponseSchema
  )
  const nonce = (initData.nonce ?? '').trim()
  if (!nonce) throw new Error('DingTalk registration init: missing nonce')

  const beginData = await apiPost('/app/registration/begin', { nonce }, DingTalkRegistrationBeginResponseSchema)
  const deviceCode = (beginData.device_code ?? '').trim()
  const verificationUrl = (beginData.verification_uri_complete ?? '').trim()
  if (!deviceCode) throw new Error('DingTalk registration begin: missing device_code')
  if (!verificationUrl) throw new Error('DingTalk registration begin: missing verification_uri_complete')

  const expiresIn = beginData.expires_in ?? 7200
  const interval = Math.max(beginData.interval ?? 3, 2)

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

    let data: z.infer<typeof DingTalkRegistrationPollResponseSchema>
    try {
      data = await apiPost(
        '/app/registration/poll',
        { device_code: begin.deviceCode },
        DingTalkRegistrationPollResponseSchema
      )
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

    const status = (data.status ?? '').trim().toUpperCase() as PollStatus

    if (status === 'WAITING') {
      statusRetryStart = 0
      continue
    }
    if (status === 'SUCCESS') {
      const clientId = (data.client_id ?? '').trim()
      const clientSecret = (data.client_secret ?? '').trim()
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
    throw new Error(`DingTalk authorization failed: ${data.fail_reason ?? status}`)
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
