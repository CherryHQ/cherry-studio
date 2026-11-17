import { describe, expect, it } from 'vitest'

import {
  createAgentProxyEnvironmentFingerprint,
  hasStaleCherryProxyMarkers,
  isAgentProxyEnvironmentKey,
  mergeAgentLoopbackProxyBypass,
  stripInheritedCherryProxyMarkers
} from '../agentProxyEnvironment'

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
      no_proxy: 'localhost,127.0.0.1,::1',
      NO_PROXY: 'localhost,127.0.0.1,::1'
    })
  })

  it('merges lowercase then uppercase bypass variables across supported separators on Linux', () => {
    const environment = {
      HTTP_PROXY: 'http://proxy.example.com:8080',
      no_proxy: 'Example.COM, 127.0.0.1 ; ::1',
      NO_PROXY: 'example.com\tLOCALHOST; [::1], Api.Example.com'
    }

    const result = mergeAgentLoopbackProxyBypass(environment, { platform: 'linux' })

    expect(result.no_proxy).toBe('Example.COM,127.0.0.1,::1,LOCALHOST,Api.Example.com')
    expect(result.NO_PROXY).toBe(result.no_proxy)
  })

  it.each(['::1,[::1]', '[::1],::1'])('collapses a bracketed IPv6 loopback entry into the bare rule: %s', (bypass) => {
    const result = mergeAgentLoopbackProxyBypass({
      HTTPS_PROXY: 'http://proxy.example.com:8080',
      no_proxy: bypass
    })

    expect(result.no_proxy).toBe('::1,localhost,127.0.0.1')
    expect(result.NO_PROXY).toBe('::1,localhost,127.0.0.1')
  })

  it.each(['linux', 'win32'] as const)(
    'normalizes the complete custom default bypass environment on %s',
    (platform) => {
      const bypass =
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,[::1],::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10,127.0.0.1,::1'
      const environment = Object.freeze({
        HTTP_PROXY: 'http://proxy.example.com:8080',
        NO_PROXY: bypass,
        no_proxy: bypass,
        CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: bypass
      })

      const result = mergeAgentLoopbackProxyBypass(environment, { platform })

      expect(result.NO_PROXY).toBe(
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,::1,169.254.0.0/16,127.0.0.1'
      )
      expect(result.no_proxy).toBe(
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,::1,169.254.0.0/16,127.0.0.1'
      )
      expect(result.CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES).toBe(bypass)
      expect(result.HTTP_PROXY).toBe(environment.HTTP_PROXY)
      expect(result).not.toBe(environment)
      expect(environment).toEqual({
        HTTP_PROXY: 'http://proxy.example.com:8080',
        NO_PROXY: bypass,
        no_proxy: bypass,
        CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: bypass
      })
    }
  )

  it.each([
    ['2001:db8::/32,::ffff:127.0.0.0/104,fe80::/10', 'localhost,127.0.0.1,::1'],
    ['::/0,::1/128,fe80::/129,fe80::1%eth0/64', 'localhost,127.0.0.1,::1'],
    ['127.0.0.0/8,169.254.0.0/16', '127.0.0.0/8,169.254.0.0/16,localhost,127.0.0.1,::1'],
    ['[::1]:8080,http://[::1],[example.com]', '[::1]:8080,http://[::1],[example.com],localhost,127.0.0.1,::1'],
    [
      '[fe80::]/10,[fe80::/10],fe80::/x,fe80::/10/20',
      '[fe80::]/10,[fe80::/10],fe80::/x,fe80::/10/20,localhost,127.0.0.1,::1'
    ],
    ['fe80::/10,*', '*'],
    ['Example.COM;example.com,[2001:DB8::1],2001:db8::1', 'Example.COM,2001:DB8::1,localhost,127.0.0.1,::1'],
    ['[0:0:0:0:0:0:0:1],::1', '0:0:0:0:0:0:0:1,::1,localhost,127.0.0.1']
  ])('converts only exact IPv6 entries and IPv6 CIDR-shaped rules: %s', (bypass, expected) => {
    const result = mergeAgentLoopbackProxyBypass({
      HTTP_PROXY: 'http://proxy.example.com:8080',
      NO_PROXY: bypass
    })

    expect(result.NO_PROXY).toBe(expected)
    expect(result.no_proxy).toBe(expected)
  })

  it('collapses both bypass variables to a standalone wildcard rule on Linux', () => {
    const result = mergeAgentLoopbackProxyBypass(
      {
        ALL_PROXY: 'socks5://proxy.example.com:1080',
        no_proxy: '*.example.com; *',
        NO_PROXY: 'localhost'
      },
      { platform: 'linux' }
    )

    expect(result.no_proxy).toBe('*')
    expect(result.NO_PROXY).toBe('*')
  })

  it.each([
    { no_proxy: 'one.example; two.example', NO_PROXY: 'THREE.example' },
    { no_proxy: '[::]', NO_PROXY: '[::1]' },
    { no_proxy: '::ffff:127.0.0.0/104', NO_PROXY: 'fe80::/10' }
  ])('returns an unchanged shallow copy when no proxy endpoint is active: %j', (bypass) => {
    const environment = {
      HTTP_PROXY: '   ',
      ...bypass
    }

    const result = mergeAgentLoopbackProxyBypass(environment, { additionalBypassRule: '[2001:db8::1]' })

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
    expect(result.NO_PROXY).toBe('corp.example,localhost,127.0.0.1,::1')
    expect(result.NO_PROXY).not.toContain('proxy.external.example')
  })

  it('does not modify the input environment', () => {
    const environment = Object.freeze({
      http_proxy: 'http://proxy.example.com:8080',
      no_proxy: 'Existing.Example'
    })
    const snapshot = { ...environment }

    mergeAgentLoopbackProxyBypass(environment)

    expect(environment).toEqual(snapshot)
  })

  it('recognizes mixed-case proxy and bypass keys on Windows', () => {
    const result = mergeAgentLoopbackProxyBypass(
      {
        Http_Proxy: 'http://proxy.example.com:8080',
        NO_PROXY: undefined,
        No_Proxy: 'service.internal,fe80::/10',
        no_proxy: 'lower.internal,::ffff:127.0.0.0/104'
      },
      { platform: 'win32' }
    )

    expect(result).toMatchObject({
      Http_Proxy: 'http://proxy.example.com:8080',
      No_Proxy: 'service.internal,fe80::/10',
      no_proxy: 'service.internal,localhost,127.0.0.1,::1',
      NO_PROXY: 'service.internal,localhost,127.0.0.1,::1'
    })
  })

  it('uses Windows child-process precedence for duplicate bypass-key variants', () => {
    const result = mergeAgentLoopbackProxyBypass(
      {
        HTTP_PROXY: 'http://proxy.example.com:8080',
        no_proxy: 'lower.internal',
        No_Proxy: 'mixed.internal',
        NO_PROXY: 'upper.internal'
      },
      { platform: 'win32' }
    )

    expect(result.NO_PROXY).toBe('upper.internal,localhost,127.0.0.1,::1')
    expect(result.no_proxy).toBe(result.NO_PROXY)
  })

  it('adds an exact materialized gateway host to the bypass rules', () => {
    const result = mergeAgentLoopbackProxyBypass(
      { HTTP_PROXY: 'http://proxy.example.com:8080' },
      { additionalBypassRule: '127.0.0.2' }
    )

    expect(result.NO_PROXY).toBe('localhost,127.0.0.1,::1,127.0.0.2')
    expect(result.no_proxy).toBe(result.NO_PROXY)
  })

  it.each([
    ['[::1]', 'localhost,127.0.0.1,::1'],
    ['[2001:db8::1]', 'localhost,127.0.0.1,::1,2001:db8::1'],
    ['fe80::/10', 'localhost,127.0.0.1,::1'],
    ['::ffff:127.0.0.0/104', 'localhost,127.0.0.1,::1'],
    [' example.com;[::1] ', 'localhost,127.0.0.1,::1, example.com;[::1] ']
  ])('converts the additional bypass rule as a single untrimmed entry: %s', (additionalBypassRule, expected) => {
    const result = mergeAgentLoopbackProxyBypass(
      { HTTP_PROXY: 'http://proxy.example.com:8080' },
      { additionalBypassRule }
    )

    expect(result.NO_PROXY).toBe(expected)
    expect(result.no_proxy).toBe(expected)
  })

  it('keeps a standalone wildcard without appending an additional gateway rule', () => {
    const result = mergeAgentLoopbackProxyBypass(
      { HTTP_PROXY: 'http://proxy.example.com:8080', NO_PROXY: 'fe80::/10,*' },
      { additionalBypassRule: '[2001:db8::1]' }
    )

    expect(result.NO_PROXY).toBe('*')
    expect(result.no_proxy).toBe('*')
  })
})

describe('stripInheritedCherryProxyMarkers', () => {
  it('removes Cherry markers without deleting an equal user-owned proxy value', () => {
    const proxyUrl = 'http://127.0.0.1:7890'

    expect(
      stripInheritedCherryProxyMarkers({
        CHERRY_STUDIO_NODE_PROXY_RULES: proxyUrl,
        CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: 'service.internal',
        HTTP_PROXY: proxyUrl,
        NO_PROXY: 'service.internal'
      })
    ).toEqual({
      HTTP_PROXY: proxyUrl,
      NO_PROXY: 'service.internal'
    })
  })
})

describe('hasStaleCherryProxyMarkers', () => {
  it('detects a cached Cherry proxy after the current proxy is disabled', () => {
    expect(
      hasStaleCherryProxyMarkers(
        {
          CHERRY_STUDIO_NODE_PROXY_RULES: 'http://stale.example:7890',
          CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: 'stale.internal'
        },
        {}
      )
    ).toBe(true)
  })

  it('keeps a cached Cherry proxy when its markers match the current proxy', () => {
    const currentProxy = {
      CHERRY_STUDIO_NODE_PROXY_RULES: 'http://current.example:7890',
      CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: ''
    }

    expect(hasStaleCherryProxyMarkers(currentProxy, currentProxy)).toBe(false)
    expect(
      hasStaleCherryProxyMarkers(currentProxy, {
        CHERRY_STUDIO_NODE_PROXY_RULES: 'http://current.example:7890'
      })
    ).toBe(false)
  })

  it('detects a bypass-rule change for the same Cherry proxy URL', () => {
    expect(
      hasStaleCherryProxyMarkers(
        {
          CHERRY_STUDIO_NODE_PROXY_RULES: 'http://current.example:7890',
          CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: 'stale.internal'
        },
        {
          CHERRY_STUDIO_NODE_PROXY_RULES: 'http://current.example:7890'
        }
      )
    ).toBe(true)
  })

  it('does not treat an unmarked user proxy as stale Cherry state', () => {
    expect(
      hasStaleCherryProxyMarkers(
        { HTTP_PROXY: 'http://user.example:7890' },
        { CHERRY_STUDIO_NODE_PROXY_RULES: 'http://current.example:7890' }
      )
    ).toBe(false)
  })
})

describe('isAgentProxyEnvironmentKey', () => {
  it('recognizes mixed-case proxy keys on Windows', () => {
    expect(isAgentProxyEnvironmentKey('Http_Proxy', { platform: 'win32' })).toBe(true)
    expect(isAgentProxyEnvironmentKey('No_Proxy', { platform: 'win32' })).toBe(true)
  })

  it('keeps proxy-key matching case-sensitive on POSIX', () => {
    expect(isAgentProxyEnvironmentKey('Http_Proxy', { platform: 'linux' })).toBe(false)
    expect(isAgentProxyEnvironmentKey('No_Proxy', { platform: 'darwin' })).toBe(false)
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
      NO_PROXY: 'Example.COM,localhost,127.0.0.1,::1'
    })

    expect(fromLowercase).toBe(fromUppercase)
  })

  it('omits IPv6 CIDR-shaped rules consistently from merged environments and fingerprints', () => {
    const environment = {
      HTTP_PROXY: 'http://proxy.example.com:8080',
      NO_PROXY: 'corp.example,fe80::/10,::ffff:127.0.0.0/104'
    }
    const withoutCidr = { ...environment, NO_PROXY: 'corp.example' }
    const merged = mergeAgentLoopbackProxyBypass(environment)
    const mergedWithoutCidr = mergeAgentLoopbackProxyBypass(withoutCidr)

    expect(merged.NO_PROXY).toBe('corp.example,localhost,127.0.0.1,::1')
    expect(merged.no_proxy).toBe('corp.example,localhost,127.0.0.1,::1')
    expect(mergedWithoutCidr.NO_PROXY).toBe('corp.example,localhost,127.0.0.1,::1')
    expect(mergedWithoutCidr.no_proxy).toBe('corp.example,localhost,127.0.0.1,::1')
    expect(createAgentProxyEnvironmentFingerprint(environment)).toBe(
      createAgentProxyEnvironmentFingerprint(withoutCidr)
    )
    expect(createAgentProxyEnvironmentFingerprint(environment)).toBe(createAgentProxyEnvironmentFingerprint(merged))
    expect(mergeAgentLoopbackProxyBypass(merged)).toEqual(merged)
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

    expect(fingerprint).not.toContain(proxyUrl)
  })

  it('normalizes proxy-key casing on Windows before hashing', () => {
    const proxyUrl = 'http://proxy.example.com:8080'

    expect(createAgentProxyEnvironmentFingerprint({ Http_Proxy: proxyUrl }, { platform: 'win32' })).toBe(
      createAgentProxyEnvironmentFingerprint({ HTTP_PROXY: proxyUrl }, { platform: 'win32' })
    )
  })

  it('uses the same case-insensitive duplicate precedence as Windows child processes', () => {
    const effective = createAgentProxyEnvironmentFingerprint(
      {
        http_proxy: 'http://lower.example.com:8080',
        Http_Proxy: 'http://mixed.example.com:8080',
        HTTP_PROXY: 'http://upper.example.com:8080'
      },
      { platform: 'win32' }
    )

    expect(effective).toBe(
      createAgentProxyEnvironmentFingerprint({ HTTP_PROXY: 'http://upper.example.com:8080' }, { platform: 'win32' })
    )
  })
})
