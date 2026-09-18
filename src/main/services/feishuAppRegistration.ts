import { gzipSync } from 'node:zlib'

import { net } from 'electron'
import { delay } from 'es-toolkit'
import * as z from 'zod'

import { loggerService } from '@logger'

const logger = loggerService.withContext('FeishuAppRegistration')

const REGISTRATION_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const DEFAULT_EXPIRY_SECONDS = 600
const MAX_POLL_INTERVAL_MS = 60_000

export type FeishuRegistrationDomain = 'feishu' | 'lark'

const BASE_URLS: Record<FeishuRegistrationDomain, string> = {
  feishu: 'https://accounts.feishu.cn',
  lark: 'https://accounts.larksuite.com'
}

export type RegistrationBeginResult = {
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

export type RegistrationVerificationOptions = {
  source?: string
  createOnly?: boolean
  name?: string
  description?: string
  addons?: {
    preset?: boolean
    userScopes?: string[]
  }
}

type PollStatus = 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token'

const registrationResponseSchema = z.record(z.string(), z.unknown())
const registrationBeginSchema = z.object({
  device_code: z.string().trim().min(1),
  verification_uri_complete: z.url()
})
const registrationPollSuccessSchema = z.object({
  client_id: z.string().trim().min(1),
  client_secret: z.string().trim().min(1),
  user_info: z.object({ open_id: z.string().trim().min(1).optional() }).optional()
})

class RegistrationRequestTimeoutError extends Error {}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function encodeAddons(options: NonNullable<RegistrationVerificationOptions['addons']>): string {
  const addons = {
    ...(options.preset !== undefined && { preset: options.preset }),
    ...(options.userScopes && { scopes: { user: options.userScopes } })
  }
  return gzipSync(Buffer.from(JSON.stringify(addons), 'utf8')).toString('base64url')
}

function configureVerificationUri(uri: string, options: RegistrationVerificationOptions): string {
  const url = new URL(uri)
  url.searchParams.set('from', 'sdk')
  url.searchParams.set('source', options.source ? `node-sdk/${options.source}` : 'node-sdk')
  url.searchParams.set('tp', 'sdk')
  if (options.createOnly === true) url.searchParams.set('createOnly', 'true')
  if (options.name !== undefined) url.searchParams.set('name', options.name)
  if (options.description !== undefined) url.searchParams.set('desc', options.description)
  if (options.addons !== undefined) url.searchParams.set('addons', encodeAddons(options.addons))
  return url.toString()
}

async function postRegistration(
  baseUrl: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const timeoutSignal = AbortSignal.timeout(REGISTRATION_REQUEST_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let response: Response
  try {
    response = await net.fetch(`${baseUrl}/oauth/v1/app/registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: requestSignal
    })
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    if (timeoutSignal.aborted) throw new RegistrationRequestTimeoutError()
    throw new Error('Feishu app registration request failed')
  }

  if (!response.ok) throw new Error('Feishu app registration request failed')

  try {
    const parsed = registrationResponseSchema.safeParse(JSON.parse(await response.text()))
    if (!parsed.success) throw new Error()
    return parsed.data
  } catch {
    throw new Error('Invalid response from Feishu app registration')
  }
}

export async function registrationBegin(
  domain: FeishuRegistrationDomain,
  options: { signal?: AbortSignal; verification?: RegistrationVerificationOptions } = {}
): Promise<RegistrationBeginResult> {
  const baseUrl = BASE_URLS[domain]
  const initialized = await postRegistration(baseUrl, { action: 'init' }, options.signal)
  if (typeof initialized.error === 'string') throw new Error('Feishu app registration failed')

  const response = await postRegistration(
    baseUrl,
    {
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id'
    },
    options.signal
  )

  const parsed = registrationBeginSchema.safeParse(response)
  if (!parsed.success) throw new Error('Feishu app registration could not be started')
  const expiresIn =
    positiveInteger(response.expire_in) ?? positiveInteger(response.expires_in) ?? DEFAULT_EXPIRY_SECONDS

  return {
    deviceCode: parsed.data.device_code,
    verificationUri: options.verification
      ? configureVerificationUri(parsed.data.verification_uri_complete, options.verification)
      : parsed.data.verification_uri_complete,
    interval: positiveInteger(response.interval) ?? DEFAULT_POLL_INTERVAL_SECONDS,
    expiresIn
  }
}

export async function registrationPoll(
  domain: FeishuRegistrationDomain,
  deviceCode: string,
  options: { interval: number; expiresIn: number; signal?: AbortSignal }
): Promise<RegistrationResult> {
  const baseUrl = BASE_URLS[domain]
  const deadlineSignal = AbortSignal.timeout(options.expiresIn * 1000)
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal
  let interval = options.interval * 1000

  while (!deadlineSignal.aborted) {
    try {
      await delay(interval, { signal })
      const response = await postRegistration(baseUrl, { action: 'poll', device_code: deviceCode }, signal)
      const success = registrationPollSuccessSchema.safeParse(response)
      if (success.success) {
        logger.info('Feishu app registration succeeded')
        return {
          appId: success.data.client_id,
          appSecret: success.data.client_secret,
          openId: success.data.user_info?.open_id
        }
      }

      const error = typeof response.error === 'string' ? response.error : ''
      switch (error as PollStatus) {
        case 'authorization_pending':
          continue
        case 'slow_down':
          interval = Math.min(interval + 5000, MAX_POLL_INTERVAL_MS)
          continue
        case 'access_denied':
          throw new Error('User denied the Feishu app registration')
        case 'expired_token':
          throw new Error('Feishu app registration QR code expired')
        default:
          throw new Error('Feishu app registration failed')
      }
    } catch (error) {
      if (options.signal?.aborted) throw new Error('Registration polling aborted')
      if (deadlineSignal.aborted) throw new Error('Feishu app registration timed out')
      if (error instanceof RegistrationRequestTimeoutError) continue
      throw error
    }
  }

  throw new Error('Feishu app registration timed out')
}
