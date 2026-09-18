import { gzipSync } from 'node:zlib'

import { net } from 'electron'
import { delay } from 'es-toolkit'

import { loggerService } from '@logger'

const logger = loggerService.withContext('FeishuAppRegistration')

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
    tenantScopes?: string[]
  }
}

type PollStatus = 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token'

function encodeAddons(options: NonNullable<RegistrationVerificationOptions['addons']>): string {
  const addons = {
    ...(options.preset !== undefined && { preset: options.preset }),
    ...((options.userScopes || options.tenantScopes) && {
      scopes: {
        ...(options.tenantScopes && { tenant: options.tenantScopes }),
        ...(options.userScopes && { user: options.userScopes })
      }
    })
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
  const response = await net.fetch(`${baseUrl}/oauth/v1/app/registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal
  })

  try {
    return JSON.parse(await response.text()) as Record<string, unknown>
  } catch {
    throw new Error('Invalid response from Feishu app registration')
  }
}

export async function registrationBegin(
  domain: FeishuRegistrationDomain,
  options: { signal?: AbortSignal; verification?: RegistrationVerificationOptions } = {}
): Promise<RegistrationBeginResult> {
  const baseUrl = BASE_URLS[domain]
  await postRegistration(baseUrl, { action: 'init' }, options.signal)

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

  const deviceCode = response.device_code as string | undefined
  const verificationUri = response.verification_uri_complete as string | undefined
  if (!deviceCode || !verificationUri) throw new Error('Feishu app registration could not be started')

  return {
    deviceCode,
    verificationUri: options.verification
      ? configureVerificationUri(verificationUri, options.verification)
      : verificationUri,
    interval: (response.interval as number) ?? 5,
    expiresIn: (response.expires_in as number) ?? 600
  }
}

export async function registrationPoll(
  domain: FeishuRegistrationDomain,
  deviceCode: string,
  options: { interval: number; expiresIn: number; signal?: AbortSignal }
): Promise<RegistrationResult> {
  const baseUrl = BASE_URLS[domain]
  const deadline = Date.now() + options.expiresIn * 1000
  let interval = options.interval * 1000

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new Error('Registration polling aborted')
    await delay(interval, { signal: options.signal })

    const response = await postRegistration(baseUrl, { action: 'poll', device_code: deviceCode }, options.signal)

    if (response.client_id && response.client_secret) {
      const userInfo = response.user_info as Record<string, string> | undefined
      logger.info('Feishu app registration succeeded')
      return {
        appId: response.client_id as string,
        appSecret: response.client_secret as string,
        openId: userInfo?.open_id
      }
    }

    const error = (response.error as string) ?? ''
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
        if (error) throw new Error(`Feishu registration poll error: ${error}`)
    }
  }

  throw new Error('Feishu app registration timed out')
}
