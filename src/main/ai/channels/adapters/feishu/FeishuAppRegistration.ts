import { net } from 'electron'
import { delay } from 'es-toolkit'
import * as z from 'zod'

/**
 * Feishu App Registration via Device Flow.
 *
 * Implements the `/oauth/v1/app/registration` endpoint used by openclaw-lark
 * to create a PersonalAgent self-built app by scanning a QR code.
 *
 * Flow: init -> begin (returns QR URL) -> poll (returns client_id + client_secret)
 */
import { loggerService } from '@logger'
import type { FeishuDomain } from '@shared/data/types/channel'

const logger = loggerService.withContext('FeishuAppRegistration')

const BASE_URLS: Record<FeishuDomain, string> = {
  feishu: 'https://accounts.feishu.cn',
  lark: 'https://accounts.larksuite.com'
}

type RegistrationBeginResult = {
  deviceCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

export type RegistrationResult = {
  appId: string
  appSecret: string
  openId?: string
}

const RegistrationResponseSchema = z.looseObject({
  device_code: z.string().nullish(),
  verification_uri_complete: z.string().nullish(),
  interval: z.number().nullish(),
  expires_in: z.number().nullish(),
  client_id: z.string().nullish(),
  client_secret: z.string().nullish(),
  user_info: z.looseObject({ open_id: z.string().nullish() }).nullish(),
  error: z.string().nullish()
})

async function postRegistration(baseUrl: string, params: Record<string, string>) {
  const url = `${baseUrl}/oauth/v1/app/registration`
  // The Feishu registration API requires application/x-www-form-urlencoded,
  // matching the format used by @larksuiteoapi/openclaw-lark-tools.
  const body = new URLSearchParams(params).toString()
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })

  const text = await res.text()
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON from Feishu registration API: ${text.slice(0, 200)}`)
  }
  const parsed = RegistrationResponseSchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid Feishu registration API response')
  // SAFETY: The schema only checks fields without transforming them; keep original extension keys in diagnostic logs.
  return value as z.output<typeof RegistrationResponseSchema>
}

export async function registrationBegin(domain: FeishuDomain): Promise<RegistrationBeginResult> {
  const baseUrl = BASE_URLS[domain]

  // Step 1: init — check supported auth methods
  const initRes = await postRegistration(baseUrl, { action: 'init' })
  logger.info('Feishu registration init response', { supported: initRes })

  // Step 2: begin — start device flow
  const res = await postRegistration(baseUrl, {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id'
  })

  const deviceCode = res.device_code
  const verificationUri = res.verification_uri_complete

  if (!deviceCode || !verificationUri) {
    throw new Error(`Feishu registration begin failed: ${JSON.stringify(res)}`)
  }

  return {
    deviceCode,
    verificationUri,
    interval: res.interval ?? 5,
    expiresIn: res.expires_in ?? 600
  }
}

export async function registrationPoll(
  domain: FeishuDomain,
  deviceCode: string,
  options: { interval: number; expiresIn: number; signal?: AbortSignal }
): Promise<RegistrationResult> {
  const baseUrl = BASE_URLS[domain]
  const deadline = Date.now() + options.expiresIn * 1000
  let interval = options.interval * 1000

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new Error('Registration polling aborted')
    }

    await delay(interval, { signal: options.signal })

    const res = await postRegistration(baseUrl, {
      action: 'poll',
      device_code: deviceCode
    })

    // Success: got credentials
    if (res.client_id && res.client_secret) {
      const userInfo = res.user_info
      logger.info('Feishu app registration succeeded')
      return {
        appId: res.client_id,
        appSecret: res.client_secret,
        openId: userInfo?.open_id ?? undefined
      }
    }

    // Handle error states
    const error = res.error ?? ''
    switch (error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval += 5000
        continue
      case 'access_denied':
        throw new Error('User denied the Feishu app registration')
      case 'expired_token':
        throw new Error('Feishu app registration QR code expired')
      default:
        if (error) {
          throw new Error(`Feishu registration poll error: ${error}`)
        }
        continue
    }
  }

  throw new Error('Feishu app registration timed out')
}
