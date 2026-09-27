import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { mockProxyService } from '@test-mocks/main/application'
import { net, session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { customFetch } from '../customFetch'
import {
  CERT_AUTHORITY_INVALID,
  CERT_VERIFY_ACCEPT,
  CERT_VERIFY_USE_CHROMIUM,
  createProviderScopedFetch,
  installProviderCertificateVerifyProc
} from '../providerTlsExceptions'

const { getRotatedApiKeyMock, resolveApiKeyMock, getAuthConfigMock } = vi.hoisted(() => ({
  getRotatedApiKeyMock: vi.fn<() => string>(),
  resolveApiKeyMock: vi.fn(),
  getAuthConfigMock: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock,
    resolveApiKey: resolveApiKeyMock,
    getAuthConfig: getAuthConfigMock
  }
}))

vi.mock('@main/data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    isRegistryProvider: vi.fn(() => false)
  }
}))

vi.mock('@main/services/VertexAiService', () => ({
  vertexAiService: {
    getAuthHeaders: vi.fn()
  }
}))

vi.mock('@main/services/CopilotService', () => ({
  copilotService: {
    getToken: vi.fn()
  }
}))

const { listModels } = await import('../../provider/listModels')
const { providerToAiSdkConfig } = await import('../../provider/config')

/** Self-signed leaf already used by the WebDAV fail-closed tests. CN is 127.0.0.1. */
const FIXTURE_CERT_PATH = fileURLToPath(
  new URL('../../../services/__tests__/fixtures/self-signed-cert.pem', import.meta.url)
)
const fixtureCertificate = new X509Certificate(readFileSync(FIXTURE_CERT_PATH))
const leafHost = fixtureCertificate.checkHost('127.0.0.1')
if (!leafHost) throw new Error('self-signed fixture is not a certificate for 127.0.0.1')

const UNLISTED_HOST = '10.255.255.1'
const API_ROOT = `https://${leafHost}/v1`

type VerifyProc = (
  request: { hostname: string; certificate: { data: string }; errorCode?: number; verificationResult?: string },
  callback: (result: number) => void
) => void

type PartitionSession = {
  fetch: ReturnType<typeof vi.fn>
  setCertificateVerifyProc: ReturnType<typeof vi.fn>
}

type SeenRequest = {
  url: string
  authorization: string | null
  apiKey: string | null
}

const seen: SeenRequest[] = []
let crossHostRedirect: string | null = null
let restoreDefaultVerify: (() => void) | undefined
let nodeFetch: ReturnType<typeof vi.spyOn> | undefined

const originalFromPartition = vi.mocked(session.fromPartition).getMockImplementation()
if (!originalFromPartition) throw new Error('electron session.fromPartition mock is missing')

function latestVerifyProc(setCertificateVerifyProc: { mock: { calls: unknown[][] } }): VerifyProc | undefined {
  const proc = setCertificateVerifyProc.mock.calls.at(-1)?.[0]
  return typeof proc === 'function' ? (proc as VerifyProc) : undefined
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return new URL(input.href)
  return new URL(input.url)
}

/**
 * Stand in for Chromium: the installed verify proc decides this fixture certificate.
 * Anything other than an explicit accept fails closed as a self-signed leaf.
 */
async function respond(
  setCertificateVerifyProc: { mock: { calls: unknown[][] } },
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const url = requestUrl(input)
  const headers = new Headers(init?.headers)
  seen.push({
    url: url.href,
    authorization: headers.get('authorization'),
    apiKey: headers.get('x-api-key')
  })

  const decision = await new Promise<number>((resolve) => {
    const proc = latestVerifyProc(setCertificateVerifyProc)
    if (!proc) {
      resolve(CERT_VERIFY_USE_CHROMIUM)
      return
    }
    proc(
      {
        hostname: url.hostname,
        certificate: { data: fixtureCertificate.raw.toString('base64') },
        errorCode: CERT_AUTHORITY_INVALID,
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID'
      },
      resolve
    )
  })
  if (decision !== CERT_VERIFY_ACCEPT) {
    throw new Error(`self-signed certificate (${url.hostname})`)
  }

  if (crossHostRedirect && url.hostname === leafHost && url.pathname.endsWith('/chat/completions')) {
    const location = crossHostRedirect
    crossHostRedirect = null
    return new Response(null, { status: 302, headers: { location } })
  }
  if (url.pathname.endsWith('/models')) {
    return Response.json({ data: [{ id: 'local-model', owned_by: 'local' }] })
  }
  if (url.pathname.endsWith('/chat/completions')) {
    return Response.json({ id: 'chatcmpl-local', choices: [{ message: { role: 'assistant', content: 'ok' } }] })
  }
  return new Response('unexpected path', { status: 404 })
}

function providerFor(id: string, allowSelfSignedTls: boolean, isEnabled = true): Provider {
  return makeProvider({
    id,
    isEnabled,
    settings: { allowSelfSignedTls },
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: API_ROOT }
    }
  })
}

async function chatFetchFor(provider: Provider): Promise<typeof globalThis.fetch> {
  const config = await providerToAiSdkConfig(
    provider,
    makeModel({
      providerId: provider.id,
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
  )
  const fetchImpl = config.providerSettings.fetch
  if (!fetchImpl) throw new Error('chat config has no fetch')
  return fetchImpl
}

describe('provider TLS Electron network fixture', () => {
  beforeEach(() => {
    seen.length = 0
    crossHostRedirect = null
    vi.clearAllMocks()
    getRotatedApiKeyMock.mockReturnValue('sk-test-key')
    resolveApiKeyMock.mockReturnValue({
      value: 'sk-test-key',
      apiKeySelection: { attribution: 'explicit', id: 'test-key', masked: 'sk-t****-key' }
    })
    getAuthConfigMock.mockReturnValue(null)
    mockProxyService.registerProxySession.mockReset().mockResolvedValue(undefined)
    restoreDefaultVerify = installProviderCertificateVerifyProc()

    vi.mocked(session.fromPartition).mockImplementation((partition: string) => {
      const created = originalFromPartition(partition) as unknown as PartitionSession
      created.fetch.mockImplementation((input: string | URL | Request, init?: RequestInit) =>
        respond(created.setCertificateVerifyProc, input, init)
      )
      return created as never
    })
    vi.mocked(net.fetch).mockImplementation((input: string | URL | Request, init?: RequestInit) =>
      respond(vi.mocked(session.defaultSession.setCertificateVerifyProc), input, init)
    )
    nodeFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Node fetch bypassed Electron session'))
  })

  afterEach(() => {
    restoreDefaultVerify?.()
    nodeFetch?.mockRestore()
  })

  it('binds the suite to the self-signed 127.0.0.1 fixture', () => {
    expect(fixtureCertificate.issuer).toBe(fixtureCertificate.subject)
    expect(leafHost).toBe('127.0.0.1')
    expect(leafHost).not.toBe(UNLISTED_HOST)
  })

  it('serves self-signed /v1/models and chat only through the opted-in Electron session', async () => {
    // Bug: model listing or chat would use Node fetch, or the default session would accept this leaf.
    const tlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    const provider = providerFor('fixture-opted', true)

    const models = await listModels(provider, undefined, { throwOnError: true })
    const chatFetch = await chatFetchFor(provider)
    const chat = await chatFetch(`${API_ROOT}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'X-Api-Key': 'secret' },
      body: JSON.stringify({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }] })
    })

    expect(models.map((model) => model.apiModelId)).toEqual(['local-model'])
    expect(await chat.json()).toMatchObject({ id: 'chatcmpl-local' })
    expect(chatFetch).not.toBe(customFetch)
    expect(chatFetch).not.toBe(globalThis.fetch)
    expect(seen.map((request) => request.url)).toEqual([`${API_ROOT}/models`, `${API_ROOT}/chat/completions`])
    expect(seen[0]?.authorization).toBe('Bearer sk-test-key')
    expect(seen[1]?.authorization).toBe('Bearer secret')
    expect(net.fetch).not.toHaveBeenCalled()
    expect(nodeFetch).not.toHaveBeenCalled()
    expect(vi.mocked(session.fromPartition).mock.calls.map(([partition]) => partition)).toEqual([
      'cherry-provider-tls:fixture-opted',
      'cherry-provider-tls:fixture-opted'
    ])
    expect(String(vi.mocked(session.fromPartition).mock.calls[0]?.[0])).not.toMatch(/^persist:/)
    expect(mockProxyService.registerProxySession).toHaveBeenCalled()

    const defaultProc = latestVerifyProc(vi.mocked(session.defaultSession.setCertificateVerifyProc))
    const callback = vi.fn()
    defaultProc?.({ hostname: leafHost, certificate: { data: fixtureCertificate.raw.toString('base64') } }, callback)
    expect(callback).toHaveBeenCalledWith(CERT_VERIFY_USE_CHROMIUM)
    await expect(net.fetch(`${API_ROOT}/models`)).rejects.toThrow(`self-signed certificate (${leafHost})`)
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(tlsEnv)
  })

  it('rejects a cross-host redirect that leaves the allowlisted self-signed host', async () => {
    // Bug: the certificate exception would follow the redirect onto a host the provider did not configure.
    const provider = providerFor('fixture-redirect', true)
    const chatFetch = await chatFetchFor(provider)
    crossHostRedirect = `https://${UNLISTED_HOST}/v1/chat/completions`

    await expect(
      chatFetch(`${API_ROOT}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'X-Api-Key': 'secret' },
        body: JSON.stringify({ model: 'local-model' })
      })
    ).rejects.toThrow(`self-signed certificate (${UNLISTED_HOST})`)

    expect(seen.map((request) => request.url)).toEqual([
      `${API_ROOT}/chat/completions`,
      `https://${UNLISTED_HOST}/v1/chat/completions`
    ])
    expect(seen[0]?.authorization).toBe('Bearer secret')
    expect(seen[0]?.apiKey).toBe('secret')
    expect(seen[1]?.authorization).toBeNull()
    expect(seen[1]?.apiKey).toBeNull()
    expect(net.fetch).not.toHaveBeenCalled()
    expect(nodeFetch).not.toHaveBeenCalled()
  })

  it('keeps disabled providers and providers without the opt-in on strict verification', async () => {
    // Bug: a disabled provider, or one with the opt-in off, would still accept the self-signed leaf.
    for (const provider of [providerFor('fixture-disabled', true, false), providerFor('fixture-strict', false)]) {
      seen.length = 0
      await expect(listModels(provider, undefined, { throwOnError: true })).rejects.toThrow(
        `self-signed certificate (${leafHost})`
      )
      const chatFetch = await chatFetchFor(provider)
      await expect(chatFetch(`${API_ROOT}/chat/completions`, { method: 'POST', body: '{}' })).rejects.toThrow(
        `self-signed certificate (${leafHost})`
      )
      expect(chatFetch).toBe(customFetch)
    }

    expect(session.fromPartition).not.toHaveBeenCalled()
    expect(nodeFetch).not.toHaveBeenCalled()
    expect(net.fetch).toHaveBeenCalled()
    expect(seen.every((request) => request.url.startsWith(API_ROOT))).toBe(true)
  })

  it('rejects an unlisted host on an opted-in provider session', async () => {
    // Bug: one allowlisted host would make the scoped session accept every other hostname.
    const fetchImpl = createProviderScopedFetch(providerFor('fixture-unlisted', true))

    await expect(fetchImpl(`https://${UNLISTED_HOST}/v1/models`)).rejects.toThrow(
      `self-signed certificate (${UNLISTED_HOST})`
    )
    await expect(fetchImpl(`https://${UNLISTED_HOST}/v1/chat/completions`, { method: 'POST' })).rejects.toThrow(
      `self-signed certificate (${UNLISTED_HOST})`
    )
    const listed = await fetchImpl(`${API_ROOT}/models`)
    expect(await listed.json()).toMatchObject({ data: [{ id: 'local-model' }] })
    expect(net.fetch).not.toHaveBeenCalled()
    expect(nodeFetch).not.toHaveBeenCalled()
  })
})
