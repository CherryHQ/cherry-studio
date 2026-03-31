/**
 * Feishu App Registration via Device Flow.
 *
 * Implements the `/oauth/v1/app/registration` endpoint used by openclaw-lark
 * to create a PersonalAgent self-built app by scanning a QR code.
 *
 * Flow: init -> begin (returns QR URL) -> poll (returns client_id + client_secret)
 */
import { loggerService } from '@logger'
import { net } from 'electron'

import type { FeishuDomain } from '../../../../database/schema'

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

type PollStatus = 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token'

async function postRegistration(baseUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
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
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Invalid JSON from Feishu registration API: ${text.slice(0, 200)}`)
  }
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

  const deviceCode = res.device_code as string | undefined
  const verificationUri = res.verification_uri_complete as string | undefined

  if (!deviceCode || !verificationUri) {
    throw new Error(`Feishu registration begin failed: ${JSON.stringify(res)}`)
  }

  return {
    deviceCode,
    verificationUri,
    interval: (res.interval as number) ?? 5,
    expiresIn: (res.expires_in as number) ?? 600
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

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval)
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Error('Registration polling aborted'))
        },
        { once: true }
      )
    })

    const res = await postRegistration(baseUrl, {
      action: 'poll',
      device_code: deviceCode
    })

    // Success: got credentials
    if (res.client_id && res.client_secret) {
      const userInfo = res.user_info as Record<string, string> | undefined
      logger.info('Feishu app registration succeeded')
      return {
        appId: res.client_id as string,
        appSecret: res.client_secret as string,
        openId: userInfo?.open_id
      }
    }

    // Handle error states
    const error = (res.error as string) ?? ''
    switch (error as PollStatus) {
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
