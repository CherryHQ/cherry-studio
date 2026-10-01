import { net } from 'electron'
import * as z from 'zod'

export const FEISHU_KNOWLEDGE_USER_SCOPES = [
  'wiki:node:read',
  'wiki:node:retrieve',
  'docs:document.content:read',
  'offline_access'
] as const

export const FEISHU_IDENTITY_USER_SCOPE = 'auth:user.id:read' as const
export const FEISHU_SPACE_DISCOVERY_USER_SCOPE = 'wiki:space:retrieve' as const
export const FEISHU_REQUIRED_USER_SCOPES = [...FEISHU_KNOWLEDGE_USER_SCOPES, FEISHU_IDENTITY_USER_SCOPE] as const
export const FEISHU_AUTOMATIC_ALLOWED_SCOPES = new Set<string>([
  ...FEISHU_REQUIRED_USER_SCOPES,
  FEISHU_SPACE_DISCOVERY_USER_SCOPE
])

const FEISHU_REQUEST_TIMEOUT_MS = 30_000

export const FEISHU_KNOWLEDGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
const feishuKnowledgeTokenSchema = z.string().regex(FEISHU_KNOWLEDGE_TOKEN_PATTERN)

export const FEISHU_READ_ENDPOINT_BUDGETS = {
  listWikiSpaces: { key: 'feishu.wiki.list-spaces', minimumIntervalMs: 600 },
  getWikiNode: { key: 'feishu.wiki.get-node', minimumIntervalMs: 600 },
  listWikiNodes: { key: 'feishu.wiki.list-nodes', minimumIntervalMs: 600 },
  getDocxMarkdown: { key: 'feishu.docs.get-content', minimumIntervalMs: 200 }
} as const

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

const wikiNodeSchema = z
  .object({
    space_id: z.string().trim().min(1),
    node_token: feishuKnowledgeTokenSchema,
    obj_token: z.string().trim().min(1),
    obj_type: z.string().trim().min(1),
    parent_node_token: feishuKnowledgeTokenSchema.or(z.literal('')).nullish(),
    node_type: z.enum(['origin', 'shortcut']),
    origin_node_token: feishuKnowledgeTokenSchema.or(z.literal('')).nullish(),
    origin_space_id: z.string().trim().nullish(),
    title: z.string().trim(),
    has_child: z.boolean(),
    obj_edit_time: z.union([z.string().trim().min(1), z.number().int().nonnegative()]).nullish()
  })
  .superRefine((node, context) => {
    if (node.node_type !== 'shortcut') return
    if (!node.origin_node_token) {
      context.addIssue({ code: 'custom', path: ['origin_node_token'], message: 'Shortcut origin node is required' })
    }
    if (!node.origin_space_id) {
      context.addIssue({ code: 'custom', path: ['origin_space_id'], message: 'Shortcut origin space is required' })
    }
  })

const wikiNodeResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({ node: wikiNodeSchema })
})

const wikiSpaceSchema = z.object({
  space_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullable().optional()
})

const wikiSpacePageResponseSchema = z
  .object({
    code: z.literal(0),
    data: z.object({
      items: z.array(wikiSpaceSchema).max(50).default([]),
      has_more: z.boolean(),
      page_token: z.string().trim().nullish()
    })
  })
  .superRefine((response, context) => {
    if (response.data.has_more && !response.data.page_token) {
      context.addIssue({ code: 'custom', path: ['data', 'page_token'], message: 'Next page token is required' })
    }
  })

const wikiNodePageResponseSchema = z
  .object({
    code: z.literal(0),
    data: z.object({
      items: z.array(wikiNodeSchema).max(50).default([]),
      has_more: z.boolean(),
      page_token: z.string().trim().nullish()
    })
  })
  .superRefine((response, context) => {
    if (response.data.has_more && !response.data.page_token) {
      context.addIssue({ code: 'custom', path: ['data', 'page_token'], message: 'Next page token is required' })
    }
  })

const docxMarkdownResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({ content: z.string() })
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

export type FeishuWikiNode = {
  spaceId: string
  nodeToken: string
  objToken: string
  objType: string
  parentNodeToken: string | null
  nodeType: 'origin' | 'shortcut'
  originNodeToken: string | null
  originSpaceId: string | null
  title: string
  hasChild: boolean
  objEditTime: string | null
}

export type FeishuWikiNodePage = { nodes: FeishuWikiNode[]; nextPageToken?: string }
export type FeishuWikiSpace = { spaceId: string; name: string; description: string | null }
export type FeishuWikiSpacePage = { spaces: FeishuWikiSpace[]; nextPageToken?: string }

export type FeishuProviderErrorCode =
  | 'authorization-pending'
  | 'authorization-slow-down'
  | 'authorization-denied'
  | 'authorization-expired'
  | 'app-scope-missing'
  | 'identity-unverifiable'
  | 'resource-permission-denied'
  | 'scope-not-found'
  | 'reauthorization-required'
  | 'transient'
  | 'invalid-response'

type FeishuOAuthError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_scope'
  | 'invalid_grant'

export class FeishuProviderError extends Error {
  constructor(
    readonly code: FeishuProviderErrorCode,
    readonly terminal: boolean,
    readonly retryAfterMs?: number,
    readonly diagnostics?: {
      httpStatus?: number
      providerCode?: number
      oauthError?: FeishuOAuthError
      endpoint?: 'wiki.list-nodes'
      invalidFields?: string[]
    }
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

function classifyError(
  response: Response,
  body: Record<string, unknown>,
  classifyMissingScope = false
): FeishuProviderError {
  const oauthError = typeof body.error === 'string' ? body.error : undefined
  const providerCode = typeof body.code === 'number' ? body.code : undefined
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
  const safeOauthError: FeishuOAuthError | undefined =
    oauthError === 'authorization_pending' ||
    oauthError === 'slow_down' ||
    oauthError === 'access_denied' ||
    oauthError === 'expired_token' ||
    oauthError === 'invalid_scope' ||
    oauthError === 'invalid_grant'
      ? oauthError
      : undefined
  const diagnostics = {
    httpStatus: response.status,
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(safeOauthError ? { oauthError: safeOauthError } : {})
  }
  const failure = (code: FeishuProviderErrorCode, terminal: boolean) =>
    new FeishuProviderError(code, terminal, retryAfterMs, diagnostics)
  if (oauthError === 'authorization_pending') return failure('authorization-pending', false)
  if (oauthError === 'slow_down') return failure('authorization-slow-down', false)
  if (oauthError === 'access_denied') return failure('authorization-denied', true)
  if (oauthError === 'expired_token') return failure('authorization-expired', true)
  if (oauthError === 'invalid_scope') return failure('app-scope-missing', true)
  if (classifyMissingScope && (providerCode === 99991672 || providerCode === 99991676 || providerCode === 99991679)) {
    return failure('app-scope-missing', true)
  }
  if (providerCode === 131005) return failure('scope-not-found', false)
  if (providerCode === 131006) return failure('resource-permission-denied', false)
  if (providerCode === 2889902) return failure('resource-permission-denied', false)
  if (providerCode === 2889906 || providerCode === 2889914) {
    return failure('scope-not-found', false)
  }
  if (oauthError === 'invalid_grant' || response.status === 401) {
    return failure('reauthorization-required', true)
  }
  if (providerCode === 99991663 || response.status === 429 || response.status >= 500) {
    return failure('transient', false)
  }
  return failure('invalid-response', false)
}

async function request(
  url: string,
  init: RequestInit,
  options: { allowEmpty?: boolean; classifyMissingScope?: boolean } = {}
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

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(text)
  } catch {
    if (!response.ok) throw classifyError(response, {}, options.classifyMissingScope)
    throw new FeishuProviderError('invalid-response', false)
  }

  if (parsedBody === null || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    if (!response.ok) throw classifyError(response, {}, options.classifyMissingScope)
    throw new FeishuProviderError('invalid-response', false)
  }
  const body = parsedBody as Record<string, unknown>

  if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
    throw classifyError(response, body, options.classifyMissingScope)
  }
  return body
}

export async function beginDeviceAuthorization(
  credentials: FeishuApplicationCredentials,
  signal?: AbortSignal,
  includeSpaceDiscovery = false
): Promise<FeishuDeviceAuthorization> {
  const body = await request('https://accounts.feishu.cn/oauth/v1/device_authorization', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthorization(credentials)
    },
    body: new URLSearchParams({
      client_id: credentials.appId,
      scope: [
        ...FEISHU_REQUIRED_USER_SCOPES,
        ...(includeSpaceDiscovery ? [FEISHU_SPACE_DISCOVERY_USER_SCOPE] : [])
      ].join(' ')
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

export async function getWikiNode(
  accessToken: string,
  input: { token: string; objType: 'wiki' | 'docx' },
  signal?: AbortSignal
): Promise<FeishuWikiNode> {
  const url = new URL('https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node')
  url.searchParams.set('token', input.token)
  url.searchParams.set('obj_type', input.objType)
  const parsed = wikiNodeResponseSchema.safeParse(
    await request(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal
    })
  )
  if (!parsed.success) throw new FeishuProviderError('invalid-response', false)
  return normalizeWikiNode(parsed.data.data.node)
}

export async function listWikiSpaces(
  accessToken: string,
  pageToken?: string,
  signal?: AbortSignal
): Promise<FeishuWikiSpacePage> {
  const url = new URL('https://open.feishu.cn/open-apis/wiki/v2/spaces')
  url.searchParams.set('page_size', '50')
  if (pageToken) url.searchParams.set('page_token', pageToken)
  const parsed = wikiSpacePageResponseSchema.safeParse(
    await request(
      url.toString(),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal
      },
      { classifyMissingScope: true }
    )
  )
  if (!parsed.success) throw new FeishuProviderError('invalid-response', false)
  return {
    spaces: parsed.data.data.items.map((space) => ({
      spaceId: space.space_id,
      name: space.name,
      description: space.description ?? null
    })),
    ...(parsed.data.data.has_more && parsed.data.data.page_token ? { nextPageToken: parsed.data.data.page_token } : {})
  }
}

function normalizeWikiNode(node: z.infer<typeof wikiNodeSchema>): FeishuWikiNode {
  return {
    spaceId: node.space_id,
    nodeToken: node.node_token,
    objToken: node.obj_token,
    objType: node.obj_type,
    parentNodeToken: node.parent_node_token || null,
    nodeType: node.node_type,
    originNodeToken: node.origin_node_token || null,
    originSpaceId: node.origin_space_id || null,
    title: node.title,
    hasChild: node.has_child,
    objEditTime: node.obj_edit_time === null || node.obj_edit_time === undefined ? null : String(node.obj_edit_time)
  }
}

export async function listWikiChildNodes(
  accessToken: string,
  spaceId: string,
  parentNodeToken?: string,
  pageToken?: string,
  signal?: AbortSignal
): Promise<FeishuWikiNodePage> {
  const url = new URL(`https://open.feishu.cn/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`)
  url.searchParams.set('page_size', '50')
  if (parentNodeToken) url.searchParams.set('parent_node_token', parentNodeToken)
  if (pageToken) url.searchParams.set('page_token', pageToken)
  const parsed = wikiNodePageResponseSchema.safeParse(
    await request(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal
    })
  )
  if (!parsed.success) {
    throw new FeishuProviderError('invalid-response', false, undefined, {
      endpoint: 'wiki.list-nodes',
      invalidFields: parsed.error.issues.map((issue) => issue.path.join('.'))
    })
  }
  return {
    nodes: parsed.data.data.items.map(normalizeWikiNode),
    ...(parsed.data.data.has_more && parsed.data.data.page_token ? { nextPageToken: parsed.data.data.page_token } : {})
  }
}

export async function getDocxMarkdown(
  accessToken: string,
  documentToken: string,
  signal?: AbortSignal
): Promise<string> {
  const url = new URL('https://open.feishu.cn/open-apis/docs/v1/content')
  url.searchParams.set('doc_token', documentToken)
  url.searchParams.set('doc_type', 'docx')
  url.searchParams.set('content_type', 'markdown')
  const parsed = docxMarkdownResponseSchema.safeParse(
    await request(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal
    })
  )
  if (!parsed.success) throw new FeishuProviderError('invalid-response', false)
  return parsed.data.data.content
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
