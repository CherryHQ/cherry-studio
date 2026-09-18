import { net } from 'electron'
import * as z from 'zod'

export const FEISHU_KNOWLEDGE_USER_SCOPES = [
  'wiki:node:read',
  'wiki:node:retrieve',
  'docs:document.content:read',
  'offline_access'
] as const

export const FEISHU_IDENTITY_USER_SCOPE = 'auth:user.id:read' as const
export const FEISHU_REQUIRED_USER_SCOPES = [...FEISHU_KNOWLEDGE_USER_SCOPES, FEISHU_IDENTITY_USER_SCOPE] as const
export const FEISHU_AUTOMATIC_ALLOWED_SCOPES = new Set<string>(FEISHU_REQUIRED_USER_SCOPES)

const FEISHU_REQUEST_TIMEOUT_MS = 30_000

const deviceAuthorizationSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  verification_uri_complete: z.url().optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive().optional()
})

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token_expires_in: z.number().int().positive(),
  scope: z.string()
})

const userIdentitySchema = z.object({
  code: z.literal(0),
  data: z.object({
    user_id: z.string().min(1),
    open_id: z.string().min(1),
    union_id: z.string().min(1).nullish(),
    tenant_key: z.string().min(1),
    name: z.string().min(1).nullish(),
    avatar_url: z.url().nullish()
  })
})

export type FeishuApplicationCredentials = { appId: string; appSecret: string }

export type FeishuDeviceAuthorization = {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type FeishuUserTokenSet = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshTokenExpiresIn: number
  grantedScopes: string[]
}

export type FeishuUserIdentity = {
  accountUserId: string
  accountOpenId: string
  accountUnionId: string | null
  tenantKey: string
  displayName: string | null
  avatarUrl: string | null
}

export type FeishuProviderErrorCode =
  | 'authorization-pending'
  | 'authorization-slow-down'
  | 'authorization-denied'
  | 'authorization-expired'
  | 'app-scope-missing'
  | 'identity-unverifiable'
  | 'reauthorization-required'
  | 'transient'
  | 'invalid-response'

export class FeishuProviderError extends Error {
  constructor(
    readonly code: FeishuProviderErrorCode,
    readonly terminal: boolean,
    readonly retryAfterMs?: number
  ) {
    super(`Feishu request failed: ${code}`)
    this.name = 'FeishuProviderError'
  }
}

function basicAuthorization(credentials: FeishuApplicationCredentials): string {
  return `Basic ${Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString('base64')}`
}

function splitScopes(scope: string): string[] {
  return [...new Set(scope.split(/\s+/).filter(Boolean))]
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now())
}

function classifyError(response: Response, body: Record<string, unknown>): FeishuProviderError {
  const oauthError = typeof body.error === 'string' ? body.error : undefined
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
  if (oauthError === 'authorization_pending') return new FeishuProviderError('authorization-pending', false)
  if (oauthError === 'slow_down') return new FeishuProviderError('authorization-slow-down', false, retryAfterMs)
  if (oauthError === 'access_denied') return new FeishuProviderError('authorization-denied', true)
  if (oauthError === 'expired_token') return new FeishuProviderError('authorization-expired', true)
  if (oauthError === 'invalid_scope') return new FeishuProviderError('app-scope-missing', true)
  if (oauthError === 'invalid_grant' || response.status === 401) {
    return new FeishuProviderError('reauthorization-required', true)
  }
  if (response.status === 429 || response.status >= 500) {
    return new FeishuProviderError('transient', false, retryAfterMs)
  }
  return new FeishuProviderError('invalid-response', false)
}

async function request(
  url: string,
  init: RequestInit,
  options: { allowEmpty?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  const callerSignal = init.signal ?? undefined
  const timeoutSignal = AbortSignal.timeout(FEISHU_REQUEST_TIMEOUT_MS)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
  let response: Response
  try {
    response = await net.fetch(url, { ...init, signal })
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason ?? error
    throw new FeishuProviderError('transient', false)
  }

  const text = await response.text()
  if (text === '' && options.allowEmpty && response.ok) return null

  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    if (!response.ok) throw classifyError(response, {})
    throw new FeishuProviderError('invalid-response', false)
  }

  if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
    throw classifyError(response, body)
  }
  return body
}

export async function beginDeviceAuthorization(
  credentials: FeishuApplicationCredentials,
  signal?: AbortSignal
): Promise<FeishuDeviceAuthorization> {
  const body = await request('https://accounts.feishu.cn/oauth/v1/device_authorization', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthorization(credentials)
    },
    body: new URLSearchParams({
      client_id: credentials.appId,
      scope: FEISHU_REQUIRED_USER_SCOPES.join(' ')
    }).toString(),
    signal
  })
  const parsed = deviceAuthorizationSchema.safeParse(body)
  if (!parsed.success) throw new FeishuProviderError('invalid-response', false)
  const verificationUri = parsed.data.verification_uri_complete ?? parsed.data.verification_uri
  if (new URL(verificationUri).origin !== 'https://accounts.feishu.cn') {
    throw new FeishuProviderError('invalid-response', false)
  }
  return {
    deviceCode: parsed.data.device_code,
    userCode: parsed.data.user_code,
    verificationUri,
    expiresIn: parsed.data.expires_in,
    interval: parsed.data.interval ?? 5
  }
}

async function parseToken(body: Promise<Record<string, unknown> | null>): Promise<FeishuUserTokenSet> {
  const parsed = tokenSchema.safeParse(await body)
  if (!parsed.success) throw new FeishuProviderError('invalid-response', false)
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expires_in,
    refreshTokenExpiresIn: parsed.data.refresh_token_expires_in,
    grantedScopes: splitScopes(parsed.data.scope)
  }
}

export function exchangeDeviceAuthorization(
  credentials: FeishuApplicationCredentials,
  deviceCode: string,
  signal?: AbortSignal
): Promise<FeishuUserTokenSet> {
  return parseToken(
    request('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: credentials.appId,
        client_secret: credentials.appSecret
      }).toString(),
      signal
    })
  )
}

export function refreshUserToken(
  credentials: FeishuApplicationCredentials,
  refreshToken: string,
  signal?: AbortSignal
): Promise<FeishuUserTokenSet> {
  return parseToken(
    request('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: credentials.appId,
        client_secret: credentials.appSecret
      }),
      signal
    })
  )
}

export async function getUserIdentity(accessToken: string, signal?: AbortSignal): Promise<FeishuUserIdentity> {
  const body = await request('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal
  })
  const userId = (body as { data?: { user_id?: unknown } } | null)?.data?.user_id
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new FeishuProviderError('identity-unverifiable', true)
  }
  const parsed = userIdentitySchema.safeParse(body)
  if (!parsed.success) throw new FeishuProviderError('invalid-response', false)
  return {
    accountUserId: parsed.data.data.user_id,
    accountOpenId: parsed.data.data.open_id,
    accountUnionId: parsed.data.data.union_id ?? null,
    tenantKey: parsed.data.data.tenant_key,
    displayName: parsed.data.data.name ?? null,
    avatarUrl: parsed.data.data.avatar_url ?? null
  }
}

export async function revokeUserToken(
  credentials: FeishuApplicationCredentials,
  refreshToken: string,
  signal?: AbortSignal
): Promise<void> {
  await request(
    'https://accounts.feishu.cn/oauth/v1/revoke',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token'
      }).toString(),
      signal
    },
    { allowEmpty: true }
  )
}

export function missingKnowledgeScopes(grantedScopes: readonly string[]): string[] {
  return FEISHU_REQUIRED_USER_SCOPES.filter((scope) => !grantedScopes.includes(scope))
}
