const CHERRYIN_ORIGIN = 'https://open.cherryin.ai'
const CHERRYIN_CALLBACK = 'cherrystudio://oauth/callback'

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface CherryInCredentials {
  account: string
  password: string
}

export interface CherryInOauthOptions {
  fetchImplementation?: FetchImplementation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trustedWebUrl(value: string | URL, errorMessage: string): URL {
  let url: URL
  try {
    url = value instanceof URL ? value : new URL(value)
  } catch {
    throw new Error(errorMessage)
  }
  if (url.origin !== CHERRYIN_ORIGIN || url.username || url.password) throw new Error(errorMessage)
  return url
}

function callbackUrl(value: string | URL, expectedState?: string): URL {
  let url: URL
  try {
    url = value instanceof URL ? value : new URL(value)
  } catch {
    throw new Error('CherryIN OAuth returned an invalid application callback')
  }
  if (`${url.protocol}//${url.host}${url.pathname}` !== CHERRYIN_CALLBACK) {
    throw new Error('CherryIN OAuth returned an invalid application callback')
  }
  if (!url.searchParams.get('code') || !url.searchParams.get('state')) {
    throw new Error('CherryIN OAuth callback is missing required parameters')
  }
  if (expectedState && url.searchParams.get('state') !== expectedState) {
    throw new Error('CherryIN OAuth callback state did not match the application request')
  }
  return url
}

function redirectUrl(response: Response, requestUrl: URL, errorMessage: string): URL {
  const location = response.headers.get('location')
  if (response.status < 300 || response.status >= 400 || !location) throw new Error(errorMessage)
  try {
    return new URL(location, requestUrl)
  } catch {
    throw new Error(errorMessage)
  }
}

async function apiData(response: Response, errorMessage: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(errorMessage)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(errorMessage)
  }
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) throw new Error(errorMessage)
  return payload.data
}

function requiredRedirect(data: Record<string, unknown>, errorMessage: string): string {
  if (typeof data.redirect_to !== 'string' || !data.redirect_to) throw new Error(errorMessage)
  return data.redirect_to
}

function absoluteUrl(value: string, errorMessage: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error(errorMessage)
  }
}

class SameOriginSession {
  private readonly cookies = new Map<string, string>()

  constructor(private readonly fetchImplementation: FetchImplementation) {}

  async request(url: URL, phase: string, init: RequestInit = {}): Promise<Response> {
    trustedWebUrl(url, `CherryIN OAuth ${phase} URL was rejected`)
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json, text/plain, */*')
    const cookie = Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ')
    if (cookie) headers.set('Cookie', cookie)

    let response: Response
    try {
      response = await this.fetchImplementation(url, {
        ...init,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000)
      })
    } catch {
      throw new Error(`CherryIN OAuth ${phase} request failed`)
    }
    this.captureCookies(response.headers)
    return response
  }

  private captureCookies(headers: Headers): void {
    const values =
      (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (headers.get('set-cookie') ? [headers.get('set-cookie') as string] : [])
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      const separator = pair.indexOf('=')
      if (separator <= 0) continue
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
  }
}

async function openPage(session: SameOriginSession, url: URL, phase: string): Promise<void> {
  const response = await session.request(url, phase)
  if (!response.ok) throw new Error(`CherryIN OAuth ${phase} page was unavailable`)
}

async function resolveAuthorizationDestination(
  session: SameOriginSession,
  initialUrl: URL,
  expectedState: string
): Promise<URL> {
  let nextUrl = initialUrl
  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    if (nextUrl.protocol === 'cherrystudio:') return callbackUrl(nextUrl, expectedState)
    const webUrl = trustedWebUrl(nextUrl, 'CherryIN OAuth authorization continuation was rejected')
    if (webUrl.pathname === '/oauth/consent') return webUrl
    if (webUrl.pathname !== '/oauth2/auth') {
      throw new Error('CherryIN OAuth authorization continuation was rejected')
    }
    const response = await session.request(webUrl, 'authorization continuation')
    nextUrl = redirectUrl(response, webUrl, 'CherryIN OAuth authorization continuation redirect was missing')
  }
  throw new Error('CherryIN OAuth authorization continuation exceeded the redirect limit')
}

async function requireCallback(
  session: SameOriginSession,
  redirect: string,
  expectedState: string,
  errorMessage: string
): Promise<string> {
  const destination = await resolveAuthorizationDestination(session, absoluteUrl(redirect, errorMessage), expectedState)
  if (destination.protocol !== 'cherrystudio:') throw new Error(errorMessage)
  return destination.toString()
}

async function finishConsent(session: SameOriginSession, nextUrl: URL, expectedState: string): Promise<string> {
  const consentUrl = await resolveAuthorizationDestination(session, nextUrl, expectedState)
  if (consentUrl.protocol === 'cherrystudio:') return consentUrl.toString()
  if (consentUrl.pathname !== '/oauth/consent') throw new Error('CherryIN OAuth consent redirect was rejected')
  const consentChallenge = consentUrl.searchParams.get('consent_challenge')
  if (!consentChallenge) throw new Error('CherryIN OAuth consent challenge was missing')

  await openPage(session, consentUrl, 'consent')
  const consentApiUrl = new URL('/api/oauth/consent', CHERRYIN_ORIGIN)
  consentApiUrl.searchParams.set('consent_challenge', consentChallenge)
  const consent = await apiData(
    await session.request(consentApiUrl, 'consent details'),
    'CherryIN OAuth consent details were rejected'
  )
  if (typeof consent.redirect_to === 'string' && consent.redirect_to) {
    return requireCallback(
      session,
      consent.redirect_to,
      expectedState,
      'CherryIN OAuth consent details did not return a callback'
    )
  }
  const requestedScope = Array.isArray(consent.requested_scope)
    ? consent.requested_scope.filter((scope): scope is string => typeof scope === 'string')
    : []
  const approval = await apiData(
    await session.request(new URL('/api/oauth/consent', CHERRYIN_ORIGIN), 'consent approval', {
      body: JSON.stringify({ consent_challenge: consentChallenge, grant_scope: requestedScope, remember: true }),
      headers: { 'Content-Type': 'application/json', Origin: CHERRYIN_ORIGIN, Referer: consentUrl.toString() },
      method: 'POST'
    }),
    'CherryIN OAuth consent approval was rejected'
  )
  return requireCallback(
    session,
    requiredRedirect(approval, 'CherryIN OAuth consent approval did not return a callback'),
    expectedState,
    'CherryIN OAuth consent approval did not return a callback'
  )
}

export async function completeCherryInOauth(
  authorizationUrl: string,
  credentials: CherryInCredentials,
  options: CherryInOauthOptions = {}
): Promise<string> {
  const authUrl = trustedWebUrl(authorizationUrl, 'CherryIN OAuth authorization URL was rejected')
  if (authUrl.pathname !== '/oauth2/auth') throw new Error('CherryIN OAuth authorization URL was rejected')
  const expectedState = authUrl.searchParams.get('state')
  if (!expectedState) throw new Error('CherryIN OAuth authorization state was missing')

  const session = new SameOriginSession(options.fetchImplementation ?? fetch)
  const authorization = await session.request(authUrl, 'authorization')
  const loginUrl = trustedWebUrl(
    redirectUrl(authorization, authUrl, 'CherryIN OAuth authorization redirect was missing'),
    'CherryIN OAuth authorization redirect was rejected'
  )
  if (!['/oauth/login', '/register'].includes(loginUrl.pathname)) {
    throw new Error('CherryIN OAuth authorization redirect was rejected')
  }
  const loginChallenge = loginUrl.searchParams.get('login_challenge')
  if (!loginChallenge) throw new Error('CherryIN OAuth login challenge was missing')

  await openPage(session, loginUrl, 'login')
  const loginApiUrl = new URL('/api/oauth/login', CHERRYIN_ORIGIN)
  loginApiUrl.searchParams.set('login_challenge', loginChallenge)
  const loginDetails = await apiData(
    await session.request(loginApiUrl, 'login details'),
    'CherryIN OAuth login details were rejected'
  )
  if (typeof loginDetails.redirect_to === 'string' && loginDetails.redirect_to) {
    return finishConsent(
      session,
      absoluteUrl(loginDetails.redirect_to, 'CherryIN OAuth login details returned an invalid redirect'),
      expectedState
    )
  }

  const login = await apiData(
    await session.request(new URL('/api/oauth/login', CHERRYIN_ORIGIN), 'login', {
      body: JSON.stringify({
        login_challenge: loginChallenge,
        password: credentials.password,
        username: credentials.account
      }),
      headers: { 'Content-Type': 'application/json', Origin: CHERRYIN_ORIGIN, Referer: loginUrl.toString() },
      method: 'POST'
    }),
    'CherryIN OAuth login was rejected; verify the regression account credentials'
  )
  if (login.require_2fa === true) {
    throw new Error('CherryIN regression account requires 2FA; configure an account without 2FA')
  }
  const nextUrl = requiredRedirect(login, 'CherryIN OAuth login did not return an authorization redirect')
  return finishConsent(
    session,
    absoluteUrl(nextUrl, 'CherryIN OAuth login returned an invalid authorization redirect'),
    expectedState
  )
}
