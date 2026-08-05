import { describe, expect, it } from 'vitest'

import { createAgentProxyEnvironmentFingerprint, mergeAgentLoopbackProxyBypass } from '../agentProxyEnvironment'

const ACTIVE_PROXY_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SOCKS_PROXY',
  'socks_proxy',
  'grpc_proxy'
] as const

describe('mergeAgentLoopbackProxyBypass', () => {
  it.each(ACTIVE_PROXY_KEYS)('adds loopback bypass rules for active %s', (proxyKey) => {
    const environment = { [proxyKey]: 'http://proxy.example.com:8080' }

    expect(mergeAgentLoopbackProxyBypass(environment)).toEqual({
      ...environment,
      no_proxy: 'localhost,127.0.0.1,::1,[::1]',
      NO_PROXY: 'localhost,127.0.0.1,::1,[::1]'
    })
  })

  it('merges lowercase then uppercase bypass variables across supported separators', () => {
    const environment = {
      HTTP_PROXY: 'http://proxy.example.com:8080',
      no_proxy: 'Example.COM, 127.0.0.1 ; ::1',
      NO_PROXY: 'example.com\tLOCALHOST; [::1], Api.Example.com'
    }

    const result = mergeAgentLoopbackProxyBypass(environment)

    expect(result.no_proxy).toBe('Example.COM,127.0.0.1,::1,LOCALHOST,[::1],Api.Example.com')
    expect(result.NO_PROXY).toBe(result.no_proxy)
  })

  it('keeps bare and bracketed IPv6 loopback rules distinct', () => {
    const result = mergeAgentLoopbackProxyBypass({
      HTTPS_PROXY: 'http://proxy.example.com:8080',
      no_proxy: '::1'
    })

    expect(result.no_proxy).toBe('::1,localhost,127.0.0.1,[::1]')
  })

  it('collapses both bypass variables to a standalone wildcard rule', () => {
    const result = mergeAgentLoopbackProxyBypass({
      ALL_PROXY: 'socks5://proxy.example.com:1080',
      no_proxy: '*.example.com; *',
      NO_PROXY: 'localhost'
    })

    expect(result.no_proxy).toBe('*')
    expect(result.NO_PROXY).toBe('*')
  })

  it('returns an unchanged shallow copy when no proxy endpoint is active', () => {
    const environment = {
      HTTP_PROXY: '   ',
      no_proxy: 'one.example; two.example',
      NO_PROXY: 'THREE.example'
    }

    const result = mergeAgentLoopbackProxyBypass(environment)

    expect(result).toEqual(environment)
    expect(result).not.toBe(environment)
  })

  it('preserves external proxy URLs without adding their hosts to bypass rules', () => {
    const proxyUrl = 'https://user:secret@proxy.external.example:8443/path'
    const result = mergeAgentLoopbackProxyBypass({
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: 'corp.example'
    })

    expect(result.HTTPS_PROXY).toBe(proxyUrl)
    expect(result.NO_PROXY).toBe('corp.example,localhost,127.0.0.1,::1,[::1]')
    expect(result.NO_PROXY).not.toContain('proxy.external.example')
  })

  it('does not modify the input environment', () => {
    const environment = Object.freeze({
      http_proxy: 'http://proxy.example.com:8080',
      no_proxy: 'Existing.Example'
    })
    const snapshot = { ...environment }

    const result = mergeAgentLoopbackProxyBypass(environment)

    expect(environment).toEqual(snapshot)
    expect(result).not.toBe(environment)
  })
})

describe('createAgentProxyEnvironmentFingerprint', () => {
  it('normalizes bypass separators and variable-name casing before hashing', () => {
    const proxyUrl = 'http://proxy.example.com:8080'
    const fromLowercase = createAgentProxyEnvironmentFingerprint({
      HTTP_PROXY: proxyUrl,
      no_proxy: 'Example.COM; localhost 127.0.0.1 ::1 [::1]'
    })
    const fromUppercase = createAgentProxyEnvironmentFingerprint({
      HTTP_PROXY: proxyUrl,
      NO_PROXY: 'Example.COM,localhost,127.0.0.1,::1,[::1]'
    })

    expect(fromLowercase).toBe(fromUppercase)
  })

  it('uses a fixed proxy-key order independent of object insertion order', () => {
    const first = createAgentProxyEnvironmentFingerprint({
      HTTP_PROXY: 'http://http-proxy.example.com:8080',
      ALL_PROXY: 'socks5://all-proxy.example.com:1080'
    })
    const second = createAgentProxyEnvironmentFingerprint({
      ALL_PROXY: 'socks5://all-proxy.example.com:1080',
      HTTP_PROXY: 'http://http-proxy.example.com:8080'
    })

    expect(first).toBe(second)
  })

  it.each(ACTIVE_PROXY_KEYS)('includes %s in the fingerprint', (proxyKey) => {
    const first = createAgentProxyEnvironmentFingerprint({ [proxyKey]: 'http://proxy-one.example.com:8080' })
    const second = createAgentProxyEnvironmentFingerprint({ [proxyKey]: 'http://proxy-two.example.com:8080' })

    expect(first).not.toBe(second)
  })

  it('changes when normalized bypass rules change', () => {
    const proxy = { HTTP_PROXY: 'http://proxy.example.com:8080' }

    const first = createAgentProxyEnvironmentFingerprint({ ...proxy, no_proxy: 'one.example' })
    const second = createAgentProxyEnvironmentFingerprint({ ...proxy, NO_PROXY: 'two.example' })

    expect(first).not.toBe(second)
  })

  it('does not include Cherry Studio internal proxy variables', () => {
    const environment = { HTTP_PROXY: 'http://proxy.example.com:8080' }
    const first = createAgentProxyEnvironmentFingerprint({
      ...environment,
      CHERRY_STUDIO_NODE_PROXY_RULES: 'http://internal-one.example.com:8080'
    })
    const second = createAgentProxyEnvironmentFingerprint({
      ...environment,
      CHERRY_STUDIO_NODE_PROXY_RULES: 'http://internal-two.example.com:8080'
    })

    expect(first).toBe(second)
  })

  it('returns a SHA-256 digest without exposing the proxy URL', () => {
    const proxyUrl = 'https://user:secret@proxy.example.com:8443'

    const fingerprint = createAgentProxyEnvironmentFingerprint({ HTTPS_PROXY: proxyUrl })

    expect(fingerprint).toMatch(/^[a-f\d]{64}$/)
    expect(fingerprint).not.toContain(proxyUrl)
  })
})
