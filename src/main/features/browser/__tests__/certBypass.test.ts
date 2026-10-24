import type { Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import {
  applyBrowserCertificatePolicy,
  matchCertificateBypassHost,
  normalizeCertificateBypassHost,
  parseCertificateBypassHosts
} from '../certBypass'

describe('normalizeCertificateBypassHost', () => {
  it.each([
    ['nas.local', 'nas.local'],
    ['  NAS.LOCAL ', 'nas.local'],
    ['https://nas.local:5001/admin', 'nas.local'],
    ['http://NAS.local/', 'nas.local'],
    ['10.0.0.2:8443', '10.0.0.2'],
    ['[::1]:8443', '[::1]'],
    ['::1', '[::1]'],
    ['localhost', 'localhost'],
    ['router.internal:8443', 'router.internal'],
    ['*.example.com', null],
    ['nas.local/path', null],
    ['foo bar', null],
    ['', null],
    ['# comment', null]
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCertificateBypassHost(input)).toBe(expected)
  })
})

describe('parseCertificateBypassHosts', () => {
  it('parses, normalizes and dedups array input', () => {
    expect(parseCertificateBypassHosts(['nas.local', 'NAS.LOCAL', '10.0.0.2'])).toEqual(['nas.local', '10.0.0.2'])
  })

  it('splits string input on newlines, commas and semicolons', () => {
    expect(parseCertificateBypassHosts('nas.local, 10.0.0.2;# comment\nhttps://x.internal')).toEqual([
      'nas.local',
      '10.0.0.2',
      'x.internal'
    ])
  })

  it('drops invalid entries and handles absent values', () => {
    expect(parseCertificateBypassHosts(['*.a.com', '', 'nas.local/path'])).toEqual([])
    expect(parseCertificateBypassHosts(undefined)).toEqual([])
    expect(parseCertificateBypassHosts(null)).toEqual([])
  })
})

describe('matchCertificateBypassHost', () => {
  it('matches case-insensitively on the exact host only', () => {
    const hosts = ['nas.local', '10.0.0.2']
    expect(matchCertificateBypassHost('NAS.LOCAL', hosts)).toBe(true)
    expect(matchCertificateBypassHost('10.0.0.2', hosts)).toBe(true)
    expect(matchCertificateBypassHost('evil.com', hosts)).toBe(false)
    expect(matchCertificateBypassHost('sub.nas.local', hosts)).toBe(false)
  })
})

describe('applyBrowserCertificatePolicy', () => {
  const ERR_CERT_AUTHORITY_INVALID = -202
  const setup = (getHosts: () => unknown) => {
    const session = { setCertificateVerifyProc: vi.fn() } as unknown as Session
    applyBrowserCertificatePolicy(session, getHosts)
    expect(session.setCertificateVerifyProc).toHaveBeenCalledTimes(1)
    const registered = vi.mocked(session.setCertificateVerifyProc).mock.calls.at(0)
    if (!registered?.[0]) throw new Error('verify proc was not registered')
    const proc = registered[0]
    return { proc, run: (request: object) => new Promise<number>((resolve) => proc(request as never, resolve)) }
  }

  it('accepts only ERR_CERT_AUTHORITY_INVALID on an untrusted chain for a configured host', async () => {
    const { run } = setup(() => ['nas.local'])
    await expect(run({ errorCode: ERR_CERT_AUTHORITY_INVALID, isIssuedByKnownRoot: false, hostname: 'nas.local' })).resolves.toBe(0)
    await expect(run({ errorCode: 0, isIssuedByKnownRoot: false, hostname: 'nas.local' })).resolves.toBe(-3)
    await expect(run({ errorCode: ERR_CERT_AUTHORITY_INVALID, isIssuedByKnownRoot: true, hostname: 'nas.local' })).resolves.toBe(-3)
    await expect(run({ errorCode: -201, isIssuedByKnownRoot: false, hostname: 'nas.local' })).resolves.toBe(-3)
    await expect(run({ errorCode: ERR_CERT_AUTHORITY_INVALID, isIssuedByKnownRoot: false, hostname: 'evil.com' })).resolves.toBe(-3)
  })

  it('re-reads the preference on every verification, so edits apply live', async () => {
    let hosts: string[] = []
    const { run } = setup(() => hosts)
    await expect(
      run({ errorCode: ERR_CERT_AUTHORITY_INVALID, isIssuedByKnownRoot: false, hostname: 'nas.local' })
    ).resolves.toBe(-3)
    hosts = ['nas.local']
    await expect(
      run({ errorCode: ERR_CERT_AUTHORITY_INVALID, isIssuedByKnownRoot: false, hostname: 'nas.local' })
    ).resolves.toBe(0)
  })

  it('is idempotent per session', () => {
    const session = { setCertificateVerifyProc: vi.fn() } as unknown as Session
    applyBrowserCertificatePolicy(session, () => [])
    applyBrowserCertificatePolicy(session, () => [])
    expect(session.setCertificateVerifyProc).toHaveBeenCalledTimes(1)
  })
})
