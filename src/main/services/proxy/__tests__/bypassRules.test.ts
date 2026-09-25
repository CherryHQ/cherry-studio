import { beforeEach, describe, expect, it } from 'vitest'

import { ProxyBypassRuleMatcher } from '../bypassRules'

describe('ProxyBypassRuleMatcher', () => {
  let matcher: ProxyBypassRuleMatcher

  const updateByPassRules = (rules: string[]) => matcher.updateByPassRules(rules)
  const isByPass = (url: string) => matcher.isByPass(url)

  beforeEach(() => {
    matcher = new ProxyBypassRuleMatcher()
  })

  it('matches simple hostname patterns', () => {
    updateByPassRules(['foobar.com'])
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://www.foobar.com')).toBe(false)

    updateByPassRules(['*.foobar.com'])
    expect(isByPass('http://api.foobar.com')).toBe(true)
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://foobar.org')).toBe(false)

    updateByPassRules(['*foobar.com'])
    expect(isByPass('http://devfoobar.com')).toBe(true)
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://foobar.company')).toBe(false)
  })

  it('matches hostname patterns with scheme and port qualifiers', () => {
    updateByPassRules(['https://secure.example.com'])
    expect(isByPass('https://secure.example.com')).toBe(true)
    expect(isByPass('https://secure.example.com:443/home')).toBe(true)
    expect(isByPass('http://secure.example.com')).toBe(false)

    updateByPassRules(['https://secure.example.com:8443'])
    expect(isByPass('https://secure.example.com:8443')).toBe(true)
    expect(isByPass('https://secure.example.com')).toBe(false)
    expect(isByPass('https://secure.example.com:443')).toBe(false)

    updateByPassRules(['https://x.*.y.com:99'])
    expect(isByPass('https://x.api.y.com:99')).toBe(true)
    expect(isByPass('https://x.api.y.com')).toBe(false)
    expect(isByPass('http://x.api.y.com:99')).toBe(false)
  })

  it('matches domain suffix patterns with leading dot', () => {
    updateByPassRules(['.example.com'])
    expect(isByPass('https://example.com')).toBe(true)
    expect(isByPass('https://api.example.com')).toBe(true)
    expect(isByPass('https://deep.api.example.com')).toBe(true)
    expect(isByPass('https://example.org')).toBe(false)

    updateByPassRules(['.com'])
    expect(isByPass('https://anything.com')).toBe(true)
    expect(isByPass('https://example.org')).toBe(false)

    updateByPassRules(['http://.google.com'])
    expect(isByPass('http://maps.google.com')).toBe(true)
    expect(isByPass('https://maps.google.com')).toBe(false)
  })

  it('matches IP literals, CIDR ranges, and wildcard IPs', () => {
    updateByPassRules(['127.0.0.1', '[::1]', '192.168.1.0/24', 'fefe:13::abc/33', '192.168.*.*'])

    expect(isByPass('http://127.0.0.1')).toBe(true)
    expect(isByPass('http://[::1]')).toBe(true)
    expect(isByPass('http://192.168.1.55')).toBe(true)
    expect(isByPass('http://192.168.200.200')).toBe(true)
    expect(isByPass('http://192.169.1.1')).toBe(false)
    expect(isByPass('http://[fefe:13::abc]')).toBe(true)
  })

  it('matches unbracketed IPv6 literals as addresses, not as host:port pairs', () => {
    updateByPassRules(['::1'])
    expect(isByPass('http://[::1]')).toBe(true)
    expect(isByPass('http://[::1]:8080')).toBe(true)
    expect(isByPass('http://[::2]')).toBe(false)

    updateByPassRules(['fe80::1', '2001:db8::1'])
    expect(isByPass('http://[fe80::1]:8080')).toBe(true)
    expect(isByPass('http://[2001:db8::1]')).toBe(true)
    expect(isByPass('http://[2001:db8::2]')).toBe(false)
  })

  it('matches an IPv6 rule whatever notation the URL host uses', () => {
    updateByPassRules(['0:0:0:0:0:0:0:1'])
    expect(isByPass('http://[::1]:8080')).toBe(true)
    expect(isByPass('http://[0:0:0:0:0:0:0:1]')).toBe(true)
    expect(isByPass('http://[::2]')).toBe(false)

    updateByPassRules(['::FFFF:127.0.0.1'])
    expect(isByPass('http://[::ffff:127.0.0.1]')).toBe(true)
  })

  it('still splits the port of a bracketed IPv6 host', () => {
    updateByPassRules(['[::1]:8080'])
    expect(isByPass('http://[::1]:8080')).toBe(true)
    expect(isByPass('http://[::1]')).toBe(false)

    updateByPassRules(['example.com:8080'])
    expect(isByPass('http://example.com:8080')).toBe(true)
    expect(isByPass('http://example.com')).toBe(false)
  })

  it('reads `::1:8080` as the address it is, since a URL carries an IPv6 port in brackets', () => {
    updateByPassRules(['::1:8080'])
    expect(isByPass('http://[::1:8080]')).toBe(true)
    expect(isByPass('http://[::1]:8080')).toBe(false)
  })

  it('matches CIDR ranges specified with IPv6 prefix lengths', () => {
    updateByPassRules(['[2001:db8::1]', '2001:db8::/32'])

    expect(isByPass('http://[2001:db8::1]')).toBe(true)
    expect(isByPass('http://[2001:db8:0:0:0:0:0:ffff]')).toBe(true)
    expect(isByPass('http://[2001:db9::1]')).toBe(false)
  })

  it('matches local addresses when <local> keyword is provided', () => {
    updateByPassRules(['<local>'])

    expect(isByPass('http://localhost')).toBe(true)
    expect(isByPass('http://127.0.0.1')).toBe(true)
    expect(isByPass('http://[::1]')).toBe(true)
    expect(isByPass('http://dev.localdomain')).toBe(false)
  })
})

describe('ProxyBypassRuleMatcher — <-loopback> ordering', () => {
  let matcher: ProxyBypassRuleMatcher
  beforeEach(() => {
    matcher = new ProxyBypassRuleMatcher()
  })

  const withRules = (rules: string[]) => matcher.updateByPassRules(rules)

  it('negative-only sends the whole loopback scope through the proxy', () => {
    withRules(['<-loopback>'])
    expect(matcher.isByPass('http://127.0.0.1:8001/')).toBe(false)
    expect(matcher.isByPass('http://127.0.0.4:8001/')).toBe(false)
    expect(matcher.isByPass('http://localhost:8001/')).toBe(false)
    expect(matcher.isByPass('http://[::1]:8001/')).toBe(false)
    expect(matcher.isByPass('http://0.0.0.0:8001/')).toBe(false)
    expect(matcher.isByPass('http://169.254.3.4:8001/')).toBe(false)
    expect(matcher.isByPass('http://[fe80::1]:8001/')).toBe(false)
    expect(matcher.isByPass('http://loopback:8001/')).toBe(false)
    expect(matcher.isByPass('http://localhost6:8001/')).toBe(false)
  })

  it('a positive rule before the negation keeps its own hosts bypassed', () => {
    withRules(['localhost', '<-loopback>'])
    expect(matcher.isByPass('http://localhost:8001/')).toBe(true)
    // the positive rule only names the literal hostname; other loopback forms fall to the negation
    expect(matcher.isByPass('http://127.0.0.1:8001/')).toBe(false)
  })

  it('a <local> rule before the negation keeps the whole loopback scope bypassed', () => {
    withRules(['<local>', '<-loopback>'])
    expect(matcher.isByPass('http://127.0.0.1:8001/')).toBe(true)
    expect(matcher.isByPass('http://127.0.0.4:8001/')).toBe(true)
    expect(matcher.isByPass('http://localhost:8001/')).toBe(true)
  })

  it('the negation before a positive rule sends loopback through the proxy', () => {
    withRules(['<-loopback>', 'localhost', '127.0.0.1', '[::1]'])
    expect(matcher.isByPass('http://127.0.0.1:8001/')).toBe(false)
    expect(matcher.isByPass('http://localhost:8001/')).toBe(false)
  })

  it('leaves non-loopback traffic on the proxy path', () => {
    withRules(['<-loopback>'])
    expect(matcher.isByPass('http://example.com:8001/')).toBe(false)
  })
})
