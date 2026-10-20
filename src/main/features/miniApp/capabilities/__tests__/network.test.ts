import dns from 'node:dns'

import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMiniAppApplication } from '../../__tests__/applicationMock'
import { MiniAppUnavailableError } from '../../errors'
import { PermissionDeniedError } from '../../grants'
import {
  isAllowedUrl,
  isPrivateAddress,
  MINI_APP_FETCH_MAX_REQUEST_BYTES,
  MINI_APP_FETCH_TIMEOUT_MS,
  networkCapability
} from '../network'
import { QuotaExceededError, resetHiddenBudgets } from '../quota'

const APP = 'com.example.mygame'
const HOSTS = ['api.mygame.com']
const SENDER = 7
const fetchAs = (params: unknown) => networkCapability.fetch(APP, params, SENDER)

vi.mock('node:dns', () => ({ default: { promises: { lookup: vi.fn() } } }))
const lookup = vi.mocked(dns.promises.lookup)

/** Visible unless a test says otherwise: the pool mounts a pane in order to show it. */
const visibility = { visible: true }
vi.mock('@application', () =>
  mockMiniAppApplication({ MiniAppRuntimeService: { isGuestVisible: () => visibility.visible } })
)
const PUBLIC = [{ address: '93.184.216.34', family: 4 }]
const PRIVATE = [{ address: '169.254.169.254', family: 4 }]

beforeEach(() => {
  lookup.mockReset()
  lookup.mockResolvedValue(PUBLIC as never)
  // Module singletons, so a hidden-budget case would otherwise leave its spend behind for
  // every later test that happens to run with the same sender.
  visibility.visible = true
  resetHiddenBudgets(SENDER)
})

// `installationOf` is a plain row read already covered by the installer tests; here the
// manifest is the fixture. Hosts need `network.fetch` or the schema refuses them.
vi.mock('../../install/installer', () => ({
  installationOf: () => ({
    manifestJson: {
      id: 'com.example.mygame',
      name: 'My Game',
      description: 'A tiny sample game.',
      version: '1.0.0',
      entry: 'index.html',
      permissions: ['network.fetch'],
      network: ['api.mygame.com']
    }
  })
}))

describe('isAllowedUrl', () => {
  it('allows a declared host over https', () => {
    expect(isAllowedUrl('https://api.mygame.com/v1', HOSTS)).toBe(true)
  })

  it('does not let a declared host match a lookalike suffix', () => {
    expect(isAllowedUrl('https://evil-api.mygame.com.attacker.io/', HOSTS)).toBe(false)
  })

  it('does not treat a declared host as a wildcard parent', () => {
    expect(isAllowedUrl('https://sub.api.mygame.com/', HOSTS)).toBe(false)
  })

  it('refuses an IP literal even when it is declared', () => {
    // The declaration regex admits all-numeric labels, so `127.0.0.1` looks like an
    // ordinary hostname — and reaches whatever the user is running locally.
    expect(isAllowedUrl('https://127.0.0.1/admin', ['127.0.0.1'])).toBe(false)
    expect(isAllowedUrl('https://[::1]/admin', ['[::1]'])).toBe(false)
  })

  it('refuses a non-default port rather than matching on it', () => {
    // `parsed.host` carries the port and a declaration cannot, so comparing hosts
    // would fail with nothing the author could ever write to fix it.
    expect(isAllowedUrl('https://api.mygame.com:8443/', HOSTS)).toBe(false)
    expect(isAllowedUrl('https://api.mygame.com:443/', HOSTS)).toBe(true)
  })

  it('allows https only — no wss, no plaintext, nothing exotic', () => {
    expect(isAllowedUrl('wss://api.mygame.com/socket', HOSTS)).toBe(false)
    expect(isAllowedUrl('http://api.mygame.com/', HOSTS)).toBe(false)
    expect(isAllowedUrl('ftp://api.mygame.com/x', HOSTS)).toBe(false)
    expect(isAllowedUrl('file:///etc/passwd', HOSTS)).toBe(false)
  })

  it('allows nothing when nothing is declared', () => {
    expect(isAllowedUrl('https://api.mygame.com/v1', [])).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('refuses loopback, unspecified, RFC 1918, link-local, ULA and mapped forms', () => {
    for (const a of [
      '127.0.0.1',
      '127.255.255.255',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'FE80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '100.64.0.1',
      '100.127.255.255',
      '::ffff:100.64.1.1',
      '::ffff:6440:101',
      '192.0.0.1',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255',
      '64:ff9b::808:808',
      '2002:c0a8:101::',
      '2001::1',
      'fec0::1',
      'ff02::1',
      '100::1'
    ]) {
      expect(isPrivateAddress(a), a).toBe(true)
    }
  })

  it('refuses what it cannot parse rather than letting it through', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
  })

  it('leaves the benchmarking range alone: fake-IP proxies answer every lookup from it', () => {
    // Clash and Surge hand out 198.18.0.0/15 for every name they intercept; refusing it
    // would refuse every `network.fetch` on those machines.
    for (const a of ['198.18.0.1', '198.18.1.85', '198.19.255.255', '::ffff:198.18.1.85']) {
      expect(isPrivateAddress(a), a).toBe(false)
    }
  })

  it('passes public addresses, including the RFC 1918 neighbours', () => {
    for (const a of [
      '93.184.216.34',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '2606:4700::1111',
      '::ffff:93.184.216.34',
      '100.63.255.255',
      '100.128.0.0',
      '192.0.1.1',
      '223.255.255.255',
      '2001:db8::1'
    ]) {
      expect(isPrivateAddress(a), a).toBe(false)
    }
  })
})

describe('networkCapability.fetch', () => {
  it('refuses a host the app never declared, and says so', async () => {
    // The name is PermissionDenied, but the grant IS held: a message blaming the grant
    // sends the author to the permissions page instead of to their URL.
    const refusal = fetchAs({ url: 'https://evil.example/x' })
    await expect(refusal).rejects.toThrow(PermissionDeniedError)
    await expect(refusal).rejects.toThrow(/https:\/\/evil\.example\/x/)
    await expect(refusal).rejects.not.toThrow(/not granted/)
  })

  it('refuses redirects instead of following them', async () => {
    // Per-hop adjudication is the alternative and it is worse: it requires getting
    // every hop right, whereas refusing has no intermediate state.
    const spy = vi
      .spyOn(net, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))
      .mockClear()
    await fetchAs({ url: 'https://api.mygame.com/v1' })
    expect(spy.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })

  it('stops reading a response that exceeds the body cap', async () => {
    // Checked WHILE streaming, not after: reading it all and then refusing means the
    // remote already decided how much memory we spend.
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(new Uint8Array(1024 * 1024))
    })
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(endless, { status: 200 }))
    await expect(fetchAs({ url: 'https://api.mygame.com/v1' })).rejects.toThrow(QuotaExceededError)
  })

  it('never sends the session credentials', async () => {
    // Electron sends session auth data by DEFAULT. Without `omit`, a domain grant would
    // also hand over whatever the user has authenticated to Cherry with.
    const spy = vi
      .spyOn(net, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))
      .mockClear()
    await fetchAs({ url: 'https://api.mygame.com/v1' })
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
  })

  it('refuses a Host header rather than sending it', async () => {
    // The allowlist names a machine; `Host` names a backend behind it. Letting the app
    // set it turns "may reach api.mygame.com" into "may reach anything it fronts".
    await expect(fetchAs({ url: 'https://api.mygame.com/v1', headers: { Host: 'internal-admin' } })).rejects.toThrow()
  })

  it('refuses a forbidden header regardless of case', async () => {
    // The control for the case above: a Set lookup on the raw key passes `Host` and
    // lets `host` straight through.
    await expect(
      fetchAs({ url: 'https://api.mygame.com/v1', headers: { 'transfer-encoding': 'chunked' } })
    ).rejects.toThrow()
  })

  it("still allows Authorization — the app's own credential", async () => {
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
    await expect(
      fetchAs({ url: 'https://api.mygame.com/v1', headers: { Authorization: 'Bearer x' } })
    ).resolves.toMatchObject({ status: 200 })
  })

  it('returns status and headers even for an error status', async () => {
    // A 404 is an ANSWER, not a failure of the capability. Throwing here would make
    // every REST client written against this API wrong.
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }))
    const r = await fetchAs({ url: 'https://api.mygame.com/v1' })
    expect(r.status).toBe(404)
  })

  it('refuses a declared host that resolves to a private address', async () => {
    // The declaration is a NAME the author controls; pointing it at 169.254.169.254
    // makes the main process fetch cloud metadata on the app's behalf.
    lookup.mockResolvedValue(PRIVATE as never)
    const spy = vi.spyOn(net, 'fetch').mockClear()
    const refusal = fetchAs({ url: 'https://api.mygame.com/v1' })
    await expect(refusal).rejects.toThrow(PermissionDeniedError)
    await expect(refusal).rejects.toThrow(/private address/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses when only one of several answers is private', async () => {
    // Chromium picks which answer to connect to; any private one is one too many.
    lookup.mockResolvedValue([...PUBLIC, { address: '::ffff:10.0.0.1', family: 6 }] as never)
    await expect(fetchAs({ url: 'https://api.mygame.com/v1' })).rejects.toThrow(PermissionDeniedError)
  })

  it('reports a failed lookup as the remote failing, not as a denial', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(fetchAs({ url: 'https://api.mygame.com/v1' })).rejects.toThrow(/failed: ENOTFOUND/)
  })

  it("reports a remote failure as Unavailable, not as the author's bug", async () => {
    // Raw, the bridge answers `Internal` — a refused connection on the author's
    // declared host would then read as a defect in the app's own code.
    vi.spyOn(net, 'fetch').mockRejectedValue(new TypeError('net::ERR_CONNECTION_REFUSED'))

    await expect(fetchAs({ url: 'https://api.mygame.com/v1' })).rejects.toThrow(MiniAppUnavailableError)
  })

  it('aborts an exchange that outlives the timeout and frees the slot', async () => {
    // Covers the WHOLE exchange: a server that answers and then dangles its body would
    // otherwise hold a concurrency slot for as long as it likes.
    vi.useFakeTimers()
    try {
      vi.spyOn(net, 'fetch').mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            (init as RequestInit).signal!.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            )
          )
      )
      // Expectation attached BEFORE the clock moves, or the rejection lands unhandled.
      const refused = expect(fetchAs({ url: 'https://api.mygame.com/v1' })).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(MINI_APP_FETCH_TIMEOUT_MS)

      await refused
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts what a departed guest still had in flight and frees its slot', async () => {
    // lifecycle.md promises a fetch dies with its guest; the timer alone let it run on for 30 s.
    // Like the real `net.fetch`, a signal that is ALREADY aborted rejects at once.
    vi.spyOn(net, 'fetch').mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal!
      const refuse = () => new DOMException('aborted', 'AbortError')
      return new Promise((_resolve, reject) =>
        signal.aborted ? reject(refuse()) : signal.addEventListener('abort', () => reject(refuse()))
      )
    })
    const refused = expect(fetchAs({ url: 'https://api.mygame.com/v1' })).rejects.toThrow(/guest/)
    networkCapability.forgetGuest(SENDER)
    await refused

    vi.spyOn(net, 'fetch').mockResolvedValue(new Response('ok'))
    await expect(fetchAs({ url: 'https://api.mygame.com/v1' })).resolves.toMatchObject({ status: 200 })
  })

  it('refuses a request body over the byte cap even when its base64 fits the char cap', async () => {
    // base64 only bounds what it decodes to from above; one byte over the cap still
    // encodes inside the char limit the schema checks.
    const spy = vi
      .spyOn(net, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))
      .mockClear()
    const body = Buffer.alloc(MINI_APP_FETCH_MAX_REQUEST_BYTES + 1).toString('base64')

    await expect(fetchAs({ url: 'https://api.mygame.com/v1', method: 'POST', body })).rejects.toThrow(
      QuotaExceededError
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses TRACE and CONNECT while passing an ordinary method through', async () => {
    // Request-smuggling surface `net.fetch` would send without comment.
    const spy = vi
      .spyOn(net, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))
      .mockClear()
    for (const method of ['TRACE', 'CONNECT']) {
      await expect(fetchAs({ url: 'https://api.mygame.com/v1', method })).rejects.toThrow()
    }
    expect(spy).not.toHaveBeenCalled()

    await fetchAs({ url: 'https://api.mygame.com/v1', method: 'HEAD' })
    expect(spy.mock.calls[0][1]).toMatchObject({ method: 'HEAD' })
  })

  it('does not forward cookie or hop-by-hop response headers', async () => {
    vi.spyOn(net, 'fetch').mockResolvedValue(
      new Response('', {
        status: 200,
        headers: {
          'set-cookie': 'sid=1',
          connection: 'close',
          'proxy-authenticate': 'Basic',
          'content-type': 'text/plain'
        }
      })
    )
    const r = await fetchAs({ url: 'https://api.mygame.com/v1' })
    expect(r.headers).toEqual({ 'content-type': 'text/plain' })
  })
})

describe('cherry.network.fetch — background budget', () => {
  const ok = () => vi.spyOn(net, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
  // Its OWN appId per case: the 60-a-minute limiter is a module singleton keyed by app, so
  // cases sharing one would fail on each other's spend rather than on what they assert.
  const fetchApp = (appId: string) => () => networkCapability.fetch(appId, { url: 'https://api.mygame.com/v1' }, SENDER)

  it('cuts a hidden app off after its allowance and leaves a visible one alone', async () => {
    // What this bounds: the manifest says which hosts an app may reach, and a user reads
    // that as "while I am using it". Nothing enforced the second half — a pooled tab keeps
    // its guest alive, unthrottled, and is even TOLD when it stops being watched.
    ok()
    const call = fetchApp('com.example.hidden')
    visibility.visible = false
    for (let i = 0; i < 10; i++) await call()

    await expect(call()).rejects.toThrow(/background budget exhausted/)

    // The same guest, now on screen: the allowance is about attention, not about the app.
    visibility.visible = true
    await expect(call()).resolves.toMatchObject({ status: 200 })
  })

  it('spends nothing while visible, so the allowance is whole when the user looks away', async () => {
    // The bug the ordering guards: counting visible calls would cut an app off seconds
    // after it is hidden, purely because it had been in use.
    ok()
    const call = fetchApp('com.example.visible')
    // More than the allowance, so a budget that counted these would already be spent.
    for (let i = 0; i < 15; i++) await call()

    visibility.visible = false
    for (let i = 0; i < 10; i++) await expect(call()).resolves.toMatchObject({ status: 200 })
  })
})
