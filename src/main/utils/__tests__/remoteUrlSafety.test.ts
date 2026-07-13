import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookupMock = vi.hoisted(() => vi.fn())

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock
}))

import { resolveRemoteFetchUrl, sanitizeRemoteUrl } from '../remoteUrlSafety'

function expectPrivateHostRejected(rawUrl: string, hostname: string): void {
  expect(() => sanitizeRemoteUrl(rawUrl)).toThrowError(
    `Unsafe remote url: local or private addresses are not allowed (${hostname})`
  )
}

describe('sanitizeRemoteUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it.each([
    'https://example.com/path?q=1',
    'http://example.com/path',
    'http://8.8.8.8/file',
    'https://[2001:4860:4860::8888]/file',
    'https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf?X-Amz-Signature=abc',
    'https://cdn-mineru.openxlab.org.cn/pdf/task-1.zip'
  ])('accepts public http and https urls: %s', (rawUrl) => {
    expect(sanitizeRemoteUrl(rawUrl)).toBe(rawUrl)
  })

  it('normalizes valid public urls through URL parsing', () => {
    expect(sanitizeRemoteUrl('https://[2001:4860:4860::8888]/a b?x=y z')).toBe(
      'https://[2001:4860:4860::8888]/a%20b?x=y%20z'
    )
  })

  it('does not perform DNS lookup for literal URL normalization', () => {
    expect(sanitizeRemoteUrl('https://example.com/file')).toBe('https://example.com/file')

    expect(lookupMock).not.toHaveBeenCalled()
  })

  it.each(['file:///etc/passwd', 'ftp://example.com/file', 'gopher://example.com/file'])(
    'rejects unsupported protocols: %s',
    (rawUrl) => {
      expect(() => sanitizeRemoteUrl(rawUrl)).toThrowError(`Invalid remote url: ${rawUrl}`)
    }
  )

  it.each([
    ['http://localhost:3000/file', 'localhost'],
    ['http://localhost./file', 'localhost.'],
    ['http://api.localhost/file', 'api.localhost'],
    ['http://api.localhost./file', 'api.localhost.'],
    ['http://127.0.0.1/file', '127.0.0.1'],
    ['http://0177.0.0.1/file', '127.0.0.1'],
    ['http://0x7f000001/file', '127.0.0.1'],
    ['http://10.0.0.1/file', '10.0.0.1'],
    ['http://100.64.0.1/file', '100.64.0.1'],
    ['http://169.254.1.10/file', '169.254.1.10'],
    ['http://172.16.0.1/file', '172.16.0.1'],
    ['http://192.168.1.10/file', '192.168.1.10'],
    ['http://198.18.0.1/file', '198.18.0.1'],
    ['http://224.0.0.1/file', '224.0.0.1'],
    ['http://0.0.0.0/file', '0.0.0.0'],
    ['http://255.255.255.255/file', '255.255.255.255'],
    ['http://[::]/file', '[::]'],
    ['http://[::1]/file', '[::1]'],
    ['http://[ff02::1]/file', '[ff02::1]'],
    ['http://[fc00::1]/file', '[fc00::1]'],
    ['http://[fd00::1]/file', '[fd00::1]'],
    ['http://[fe80::1]/file', '[fe80::1]'],
    ['http://[::ffff:127.0.0.1]/file', '[::ffff:7f00:1]'],
    ['http://[::ffff:192.168.1.10]/file', '[::ffff:c0a8:10a]']
  ])('rejects localhost and private ip targets: %s', (rawUrl, hostname) => {
    expectPrivateHostRejected(rawUrl, hostname)
  })

  it.each(['https://user:pass@example.com/file', 'https://user@example.com/file'])(
    'rejects credential-bearing urls: %s',
    (rawUrl) => {
      expect(() => sanitizeRemoteUrl(rawUrl)).toThrowError('Unsafe remote url: credentials are not allowed')
    }
  )

  it('rejects malformed urls before protocol checks', () => {
    expect(() => sanitizeRemoteUrl('not-a-url')).toThrowError('Invalid remote url: not-a-url')
  })

  it.each([
    ['http://127.0.0.1:8000/file', 'http://127.0.0.1:8000'],
    ['http://localhost:8000/file', 'http://127.0.0.1:8000'],
    ['http://[::1]:8000/file', 'http://localhost:8000'],
    ['http://192.168.1.10:9000/file', 'http://192.168.1.10:9000']
  ])('allows provider secondary urls when they match the configured apiHost: %s', (rawUrl, configuredApiHost) => {
    expect(sanitizeRemoteUrl(rawUrl, configuredApiHost)).toBe(rawUrl)
  })

  it.each([
    ['http://127.0.0.1:9000/file', 'http://127.0.0.1:8000', '127.0.0.1'],
    ['http://192.168.1.11:9000/file', 'http://192.168.1.10:9000', '192.168.1.11']
  ])(
    'still rejects provider secondary urls that do not match the configured apiHost: %s',
    (rawUrl, configuredApiHost, hostname) => {
      expectPrivateHostRejected(rawUrl, hostname)
      expect(() => sanitizeRemoteUrl(rawUrl, configuredApiHost)).toThrowError(
        `Unsafe remote url: local or private addresses are not allowed (${hostname})`
      )
    }
  )
})

describe('resolveRemoteFetchUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it('returns the normalized URL and a prevalidated public address for hostnames', async () => {
    await expect(resolveRemoteFetchUrl('https://example.com/a b')).resolves.toEqual({
      url: 'https://example.com/a%20b',
      address: {
        address: '93.184.216.34',
        family: 4
      }
    })

    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true })
  })

  it('returns public literal addresses without DNS lookup', async () => {
    await expect(resolveRemoteFetchUrl('http://8.8.8.8/file')).resolves.toEqual({
      url: 'http://8.8.8.8/file',
      address: {
        address: '8.8.8.8',
        family: 4
      }
    })

    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects hostnames that resolve to private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])

    await expect(resolveRemoteFetchUrl('https://example.com/file')).rejects.toThrow(/DNS resolved/)
  })

  it('rejects hostnames when any resolved address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: 'fd00::1', family: 6 }
    ])

    await expect(resolveRemoteFetchUrl('https://example.com/file')).rejects.toThrow(/DNS resolved/)
  })

  it('rejects hostnames with no DNS addresses', async () => {
    lookupMock.mockResolvedValue([])

    await expect(resolveRemoteFetchUrl('https://example.com/file')).rejects.toThrow(/DNS returned no addresses/)
  })
})
