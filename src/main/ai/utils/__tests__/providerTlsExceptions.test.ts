import { session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import {
  CERT_VERIFY_ACCEPT,
  CERT_VERIFY_USE_CHROMIUM,
  collectAllowSelfSignedTlsHostnames,
  hostnameFromApiBaseUrl,
  installProviderCertificateVerifyProc,
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
  it('accepts only allowlisted hostnames and otherwise defers to Chromium', () => {
    const allowed = new Set(['llm.internal'])

    // Bug this locks: a global TLS disable would accept api.openai.com too.
    expect(resolveCertificateVerifyResult('llm.internal', allowed)).toBe(CERT_VERIFY_ACCEPT)
    expect(resolveCertificateVerifyResult('LLM.Internal', allowed)).toBe(CERT_VERIFY_ACCEPT)
    expect(resolveCertificateVerifyResult('api.openai.com', allowed)).toBe(CERT_VERIFY_USE_CHROMIUM)
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

  it('accepts only enabled opted-in provider hosts and verifies other certificates', () => {
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

    proc({ hostname: 'llm.internal' }, callback)
    expect(callback).toHaveBeenCalledWith(CERT_VERIFY_ACCEPT)

    for (const hostname of ['strict.internal', 'disabled.internal', 'api.openai.com']) {
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
