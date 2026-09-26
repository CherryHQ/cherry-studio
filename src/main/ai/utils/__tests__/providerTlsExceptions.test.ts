import { mockProxyService } from '@test-mocks/main/application'
import { net, session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { customFetch } from '../customFetch'
import {
  CERT_AUTHORITY_INVALID,
  CERT_VERIFY_ACCEPT,
  CERT_VERIFY_USE_CHROMIUM,
  collectAllowSelfSignedTlsHostnames,
  createProviderScopedFetch,
  hostnameFromApiBaseUrl,
  installProviderCertificateVerifyProc,
  releaseProviderTlsSession,
  releaseProviderTlsSessionIfInactive,
  resolveCertificateVerifyResult
} from '../providerTlsExceptions'

const listProvidersMock = vi.hoisted(() => vi.fn())

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    list: (...args: unknown[]) => listProvidersMock(...args)
  }
}))

describe('hostnameFromApiBaseUrl', () => {
  it('returns the https hostname for absolute and bare API hosts', () => {
    expect(hostnameFromApiBaseUrl('https://llm.internal:8443/v1')).toBe('llm.internal')
    expect(hostnameFromApiBaseUrl('LLM.Internal/v1')).toBe('llm.internal')
  })

  it('ignores plain HTTP hosts that do not need a TLS exception', () => {
    expect(hostnameFromApiBaseUrl('http://192.168.1.10:8080/v1')).toBeNull()
  })

  it('returns null for empty or unparseable values', () => {
    expect(hostnameFromApiBaseUrl('')).toBeNull()
    expect(hostnameFromApiBaseUrl('   ')).toBeNull()
    expect(hostnameFromApiBaseUrl('https://')).toBeNull()
  })
})

describe('collectAllowSelfSignedTlsHostnames', () => {
  it('includes every https endpoint host only when allowSelfSignedTls is enabled', () => {
    const hosts = collectAllowSelfSignedTlsHostnames([
      {
        isEnabled: true,
        settings: { allowSelfSignedTls: true },
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://llm.internal:8443/v1' },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://claude.internal/v1' }
        }
      },
      {
        isEnabled: true,
        settings: {},
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
        }
      },
      {
        isEnabled: true,
        settings: { allowSelfSignedTls: false },
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://denied.internal/v1' }
        }
      }
    ])

    expect([...hosts].sort()).toEqual(['claude.internal', 'llm.internal'])
  })

  it('keeps disabled provider hosts under Chromium certificate verification', () => {
    const hosts = collectAllowSelfSignedTlsHostnames([
      {
        isEnabled: false,
        settings: { allowSelfSignedTls: true },
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://disabled.internal/v1' }
        }
      }
    ])

    expect(resolveCertificateVerifyResult('disabled.internal', hosts)).toBe(CERT_VERIFY_USE_CHROMIUM)
  })
})

describe('resolveCertificateVerifyResult', () => {
  const authorityInvalid = { errorCode: CERT_AUTHORITY_INVALID }

  it('accepts only an untrusted issuer on an allowlisted hostname', () => {
    const allowed = new Set(['llm.internal'])

    // Bug this locks: accepting every certificate for the host would also trust
    // an expired or name-mismatched leaf, and a global bypass would trust api.openai.com.
    expect(resolveCertificateVerifyResult('llm.internal', allowed, authorityInvalid)).toBe(CERT_VERIFY_ACCEPT)
    expect(
      resolveCertificateVerifyResult('LLM.Internal', allowed, {
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID'
      })
    ).toBe(CERT_VERIFY_ACCEPT)
    expect(resolveCertificateVerifyResult('llm.internal', allowed, { errorCode: -201 })).toBe(CERT_VERIFY_USE_CHROMIUM)
    expect(resolveCertificateVerifyResult('llm.internal', allowed, { errorCode: -200 })).toBe(CERT_VERIFY_USE_CHROMIUM)
    expect(resolveCertificateVerifyResult('llm.internal', allowed, { errorCode: 0 })).toBe(CERT_VERIFY_USE_CHROMIUM)
    expect(resolveCertificateVerifyResult('llm.internal', allowed)).toBe(CERT_VERIFY_USE_CHROMIUM)
    expect(resolveCertificateVerifyResult('api.openai.com', allowed, authorityInvalid)).toBe(CERT_VERIFY_USE_CHROMIUM)
  })
})

describe('installProviderCertificateVerifyProc', () => {
  beforeEach(() => {
    vi.mocked(session.defaultSession.setCertificateVerifyProc).mockReset()
    listProvidersMock.mockReset()
  })

  function captureProc() {
    installProviderCertificateVerifyProc()
    return vi.mocked(session.defaultSession.setCertificateVerifyProc).mock.calls[0][0] as (
      request: { hostname: string },
      callback: (result: number) => void
    ) => void
  }

  it('keeps the default session fail-closed for opted-in, disabled, unlisted, and non-opted hosts', () => {
    // Bug: defaultSession's certificate callback is hostname-wide, so one opted-in
    // provider accepts unrelated and non-opted requests to the same host.
    listProvidersMock.mockReturnValue([
      {
        isEnabled: true,
        settings: { allowSelfSignedTls: true },
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://llm.internal:8443/v1' }
        }
      },
      {
        isEnabled: true,
        settings: { allowSelfSignedTls: false },
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://strict.internal/v1' }
        }
      },
      {
        isEnabled: false,
        settings: { allowSelfSignedTls: true },
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://disabled.internal/v1' }
        }
      }
    ])
    const proc = captureProc()
    const callback = vi.fn()

    for (const hostname of ['llm.internal', 'strict.internal', 'disabled.internal', 'api.openai.com']) {
      callback.mockClear()
      proc({ hostname }, callback)
      expect(callback).toHaveBeenCalledWith(CERT_VERIFY_USE_CHROMIUM)
    }
  })

  it('fails closed when the provider list is unavailable', () => {
    listProvidersMock.mockImplementation(() => {
      throw new Error('DB not ready')
    })
    const proc = captureProc()
    const callback = vi.fn()

    proc({ hostname: 'llm.internal' }, callback)
    expect(callback).toHaveBeenCalledWith(CERT_VERIFY_USE_CHROMIUM)
  })

  it('returns a disposer that restores Chromium default verification', () => {
    const dispose = installProviderCertificateVerifyProc()
    dispose()
    expect(session.defaultSession.setCertificateVerifyProc).toHaveBeenLastCalledWith(null)
  })
})

describe('createProviderScopedFetch', () => {
  const host = {
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://llm.internal/v1' }
  }

  const partitions = new Map<
    string,
    {
      fetch: ReturnType<typeof vi.fn>
      setCertificateVerifyProc: ReturnType<typeof vi.fn>
      webRequest: { onBeforeSendHeaders: ReturnType<typeof vi.fn> }
    }
  >()

  beforeEach(() => {
    partitions.clear()
    mockProxyService.registerProxySession.mockReset().mockResolvedValue(undefined)
  })

  function verify(hostname: string, errorCode: number = CERT_AUTHORITY_INVALID): number {
    const proc = [...partitions.values()][0].setCertificateVerifyProc.mock.calls.at(-1)?.[0] as (
      request: { hostname: string; errorCode?: number },
      callback: (result: number) => void
    ) => void
    const callback = vi.fn()
    proc({ hostname, errorCode }, callback)
    return callback.mock.calls[0]?.[0] as number
  }

  it('accepts only the opted-in provider host on its in-memory session', async () => {
    // Bug: a default-session hostname callback would also accept other callers of llm.internal.
    const original = vi.mocked(session.fromPartition).getMockImplementation()
    vi.mocked(session.defaultSession.setCertificateVerifyProc).mockClear()
    vi.mocked(session.fromPartition).mockImplementation((partition: string) => {
      let created = partitions.get(partition)
      if (!created) {
        created = {
          fetch: vi.fn(async () => new Response('scoped')),
          setCertificateVerifyProc: vi.fn(),
          webRequest: { onBeforeSendHeaders: vi.fn() }
        }
        partitions.set(partition, created)
      }
      return created as never
    })
    vi.mocked(net.fetch).mockImplementation(async () => new Response('default'))

    try {
      const opted = await createProviderScopedFetch({
        id: 'opted',
        isEnabled: true,
        settings: { allowSelfSignedTls: true },
        endpointConfigs: host
      })('https://llm.internal/v1/models')

      expect(await opted.text()).toBe('scoped')
      expect(mockProxyService.registerProxySession).toHaveBeenCalledTimes(1)
      expect(net.fetch).not.toHaveBeenCalled()
      expect(session.defaultSession.setCertificateVerifyProc).not.toHaveBeenCalled()
      expect([...partitions.keys()]).toEqual([expect.not.stringMatching(/^persist:/)])
      expect([...partitions.values()][0].webRequest.onBeforeSendHeaders).toHaveBeenCalledTimes(1)
      expect(verify('llm.internal')).toBe(CERT_VERIFY_ACCEPT)
      expect(verify('llm.internal', -201)).toBe(CERT_VERIFY_USE_CHROMIUM)
      expect(verify('unlisted.example')).toBe(CERT_VERIFY_USE_CHROMIUM)
      await createProviderScopedFetch({
        id: 'opted',
        isEnabled: true,
        settings: { allowSelfSignedTls: true },
        endpointConfigs: host
      })('https://llm.internal/v1/models')
      expect(partitions.size).toBe(1)

      for (const provider of [
        { id: 'strict', isEnabled: true, settings: { allowSelfSignedTls: false }, endpointConfigs: host },
        { id: 'disabled', isEnabled: false, settings: { allowSelfSignedTls: true }, endpointConfigs: host }
      ]) {
        const response = await createProviderScopedFetch(provider)('https://llm.internal/v1/models')
        expect(await response.text()).toBe('default')
      }
      expect(await (await customFetch('https://llm.internal/v1/models')).text()).toBe('default')
      expect(partitions.size).toBe(1)
      expect(net.fetch).toHaveBeenCalledTimes(3)
    } finally {
      if (original) vi.mocked(session.fromPartition).mockImplementation(original)
    }
  })

  it('releases the provider session on opt-out and on deletion', async () => {
    // Bug: the in-memory partition kept accepting certificates after the toggle was cleared.
    const original = vi.mocked(session.fromPartition).getMockImplementation()
    const scoped = {
      fetch: vi.fn(async () => new Response('scoped')),
      setCertificateVerifyProc: vi.fn(),
      closeAllConnections: vi.fn(),
      webRequest: { onBeforeSendHeaders: vi.fn() }
    }
    vi.mocked(session.fromPartition).mockReturnValue(scoped as never)
    vi.mocked(net.fetch).mockImplementation(async () => new Response('default'))
    const provider = {
      id: 'opted',
      isEnabled: true,
      settings: { allowSelfSignedTls: true as const },
      endpointConfigs: host
    }

    try {
      await createProviderScopedFetch(provider)('https://llm.internal/v1/models')
      expect(mockProxyService.registerProxySession).toHaveBeenCalledWith(scoped)

      releaseProviderTlsSessionIfInactive({ ...provider, settings: { allowSelfSignedTls: false } })
      const strictFetch = createProviderScopedFetch({ ...provider, settings: { allowSelfSignedTls: false } })
      expect(await (await strictFetch('https://llm.internal/v1/models')).text()).toBe('default')
      expect(scoped.setCertificateVerifyProc).toHaveBeenCalledWith(null)
      expect(scoped.closeAllConnections).toHaveBeenCalledTimes(1)
      expect(mockProxyService.unregisterProxySession).toHaveBeenCalledWith(scoped)

      await createProviderScopedFetch(provider)('https://llm.internal/v1/models')
      mockProxyService.unregisterProxySession.mockClear()
      scoped.closeAllConnections.mockClear()
      releaseProviderTlsSessionIfInactive(provider)
      expect(mockProxyService.unregisterProxySession).not.toHaveBeenCalled()

      releaseProviderTlsSession(provider.id)
      expect(scoped.setCertificateVerifyProc).toHaveBeenLastCalledWith(null)
      expect(mockProxyService.unregisterProxySession).toHaveBeenCalledWith(scoped)
      releaseProviderTlsSession(provider.id)
      expect(mockProxyService.unregisterProxySession).toHaveBeenCalledTimes(1)
    } finally {
      if (original) vi.mocked(session.fromPartition).mockImplementation(original)
    }
  })

  it('retries proxy registration before sending after an initial failure', async () => {
    const original = vi.mocked(session.fromPartition).getMockImplementation()
    const scoped = {
      fetch: vi.fn(async () => new Response('scoped')),
      setCertificateVerifyProc: vi.fn(),
      webRequest: { onBeforeSendHeaders: vi.fn() }
    }
    vi.mocked(session.fromPartition).mockReturnValue(scoped as never)
    const registrationError = new Error('Proxy registration failed')
    mockProxyService.registerProxySession.mockRejectedValueOnce(registrationError).mockResolvedValue(undefined)
    const providerFetch = createProviderScopedFetch({
      id: 'retry',
      isEnabled: true,
      settings: { allowSelfSignedTls: true },
      endpointConfigs: host
    })

    try {
      await expect(providerFetch('https://llm.internal/v1/models')).rejects.toBe(registrationError)
      expect(scoped.fetch).not.toHaveBeenCalled()

      await expect(providerFetch('https://llm.internal/v1/models')).resolves.toBeInstanceOf(Response)
      expect(mockProxyService.registerProxySession).toHaveBeenCalledTimes(2)
      expect(scoped.fetch).toHaveBeenCalledTimes(1)
    } finally {
      if (original) vi.mocked(session.fromPartition).mockImplementation(original)
    }
  })
})
