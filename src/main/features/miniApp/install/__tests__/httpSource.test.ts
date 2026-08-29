import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { MINI_APP_MAX_PACKAGE_BYTES } from '@shared/types/miniAppManifest'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isInChina = vi.fn(async () => false)
vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina } }))

const fetch = vi.fn()
vi.mock('electron', () => ({ net: { fetch } }))

const { fetchIcon, fetchManifest, fetchPackage, mirrorOrder, MINI_APP_DOWNLOAD_IDLE_MS, MINI_APP_SOURCE_TIMEOUT_MS } =
  await import('../httpSource')

const GLOBAL = 'https://example.com/manifest.json'
const CN = 'https://cdn.example.cn/manifest.json'

const MANIFEST = {
  id: 'com.example.mygame',
  name: 'My Game',
  description: 'A tiny sample game.',
  version: '1.0.0',
  entry: 'index.html',
  permissions: [],
  network: [],
  // BOTH endpoints in both blocks — required since the dual-source gate landed, and this
  // fixture is parsed by the real `MiniAppDistributionManifestSchema`.
  update: { url: 'https://example.com/manifest.json', urlCn: 'https://cdn.example.cn/manifest.json' },
  package: {
    url: 'https://example.com/1.0.0.miniapp',
    urlCn: 'https://cdn.example.cn/1.0.0.miniapp',
    sha256: 'a'.repeat(64),
    size: 1024
  }
}

/** Like the real `net.fetch`: settles only when the signal aborts. */
const hanging = (init: RequestInit) =>
  new Promise<never>((_resolve, reject) => {
    const refuse = () => reject(new DOMException('aborted', 'AbortError'))
    if (init.signal?.aborted) refuse()
    else init.signal?.addEventListener('abort', refuse)
  })

/** A streaming response, because `fetchManifest` counts bytes as they arrive. */
const bodyOf = (value: unknown) => ({
  ok: true,
  body: (async function* () {
    yield Buffer.from(JSON.stringify(value))
  })()
})

// Neither `clearMocks` nor `restoreMocks` is set repo-wide, and these cases count calls.
beforeEach(() => {
  fetch.mockReset()
  isInChina.mockReset()
  isInChina.mockResolvedValue(false)
})

describe('mirrorOrder', () => {
  it('puts the region default first and keeps the other as fallback', async () => {
    // Both directions: a hardcoded order passes whichever single case it happens to match.
    isInChina.mockResolvedValueOnce(true)
    expect(await mirrorOrder(GLOBAL, CN)).toEqual([CN, GLOBAL])

    isInChina.mockResolvedValueOnce(false)
    expect(await mirrorOrder(GLOBAL, CN)).toEqual([GLOBAL, CN])
  })

  it('degrades to the global default when region detection fails', async () => {
    // Region detection is a network call of its own; failing it must not fail the download.
    isInChina.mockRejectedValueOnce(new Error('offline'))

    expect(await mirrorOrder(GLOBAL, CN)).toEqual([GLOBAL, CN])
  })

  it('returns the one url unchanged when no accelerator is declared', async () => {
    expect(await mirrorOrder(GLOBAL, undefined)).toEqual([GLOBAL])
  })
})

describe('mirror fallback', () => {
  it('falls back to the next mirror when the first one fails', async () => {
    fetch.mockRejectedValueOnce(new Error('ENOTFOUND')).mockResolvedValueOnce(bodyOf(MANIFEST))

    await expect(fetchManifest([GLOBAL, CN])).resolves.toMatchObject({ id: MANIFEST.id })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up on a mirror that never answers and moves to the next', async () => {
    // Without a deadline a server that accepts the connection and says nothing holds the
    // check forever, and the fallback mirror is never tried.
    vi.useFakeTimers()
    try {
      fetch
        .mockImplementationOnce((_url: string, init: RequestInit) => hanging(init))
        .mockResolvedValueOnce(bodyOf(MANIFEST))
      const manifest = fetchManifest([GLOBAL, CN])
      await vi.advanceTimersByTimeAsync(MINI_APP_SOURCE_TIMEOUT_MS)

      await expect(manifest).resolves.toMatchObject({ id: MANIFEST.id })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a failed mirror without its query, userinfo or fragment', async () => {
    // Presigned download urls carry their credential in the query, and warn logs persist.
    vi.mocked(mockMainLoggerService.warn).mockClear()
    fetch.mockRejectedValue(new Error('down'))

    await expect(fetchManifest(['https://user:pw@example.com/m.json?token=SECRET#frag'])).rejects.toThrow()

    const logged = JSON.stringify(vi.mocked(mockMainLoggerService.warn).mock.calls)
    expect(logged).toContain('https://example.com/m.json')
    expect(logged).not.toMatch(/SECRET|user:pw|frag/)
  })

  it('surfaces the LAST error when every mirror fails', async () => {
    // The fallback's failure is the one a user can usually act on; rethrowing the first
    // buries it, and "the download failed" with the wrong host in it costs a bug report.
    fetch.mockRejectedValueOnce(new Error('global down')).mockRejectedValueOnce(new Error('cn down'))

    await expect(fetchManifest([GLOBAL, CN])).rejects.toThrow(/cn down/)
  })
})

describe('package origin pin', () => {
  it('refuses a package url outside the pinned origins before any request is made', async () => {
    // The second layer under `checkForUpdate`'s fail-fast: the pin travels with the
    // request, so a caller cannot forget it — and a refused url never hits the network.
    await expect(
      fetchPackage(['https://attacker.io/p.miniapp'], {
        sha256: 'a'.repeat(64),
        size: 1024,
        origins: ['https://example.com', 'https://cdn.example.cn']
      })
    ).rejects.toThrow(/not one of the pinned/i)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('fetchPackage', () => {
  const PKG = 'https://example.com/1.0.0.miniapp'
  const ORIGINS = ['https://example.com']
  const BYTES = Buffer.from('PK\x03\x04 not really a zip, but 1 KiB of it'.padEnd(1024, '.'))
  const SHA = crypto.createHash('sha256').update(BYTES).digest('hex')
  const expectedFor = (over: Partial<{ sha256: string; size: number }> = {}) => ({
    sha256: SHA,
    size: BYTES.byteLength,
    origins: ORIGINS,
    ...over
  })
  /** Streams `chunks` in order; `served` counts how many were actually pulled. */
  const streamed = (chunks: Buffer[], headers: Record<string, string> = {}) => {
    const served = { count: 0 }
    const res = {
      ok: true,
      headers: new Headers(headers),
      body: (async function* () {
        for (const chunk of chunks) {
          served.count += 1
          yield chunk
        }
      })()
    }
    return { res, served }
  }

  let temp: string
  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-http-'))
    vi.mocked(application.getPath).mockReturnValue(temp)
  })
  afterEach(() => fs.rmSync(temp, { recursive: true, force: true }))

  it('lands the bytes the manifest pinned and hands back their only cleanup', async () => {
    // The positive control every refusal below leans on: a download that refuses
    // everything passes them all.
    fetch.mockResolvedValueOnce(streamed([BYTES.subarray(0, 700), BYTES.subarray(700)]).res)

    const pkg = await fetchPackage([PKG], expectedFor())

    expect(fs.readFileSync(pkg.path).equals(BYTES)).toBe(true)
    await pkg.cleanup()
    expect(fs.existsSync(pkg.path)).toBe(false)
    expect(fs.readdirSync(temp)).toEqual([])
  })

  it('aborts a download that stalls, but not one that is merely slow', async () => {
    // A whole-exchange deadline would cut a slow link mid-package; only silence is fatal.
    // Chunks are handed over by the test and acknowledged through `onProgress`, so the
    // fake clock only ever moves while the download is provably waiting on the server.
    vi.useFakeTimers()
    const deferred = <T>() => {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((r) => (resolve = r))
      return { promise, resolve }
    }
    const acks: Array<() => void> = []
    const onProgress = () => acks.shift()?.()
    const acked = () => new Promise<void>((resolve) => acks.push(resolve))
    try {
      const first = deferred<Buffer>()
      fetch.mockImplementationOnce((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          headers: new Headers(),
          body: (async function* () {
            yield await first.promise
            await hanging(init)
          })()
        })
      )
      const stalled = expect(fetchPackage([PKG], expectedFor(), onProgress)).rejects.toThrow(/abort/i)
      let seen = acked()
      first.resolve(BYTES.subarray(0, 100))
      await seen
      await vi.advanceTimersByTimeAsync(MINI_APP_DOWNLOAD_IDLE_MS)
      await stalled

      const chunks = [BYTES.subarray(0, 300), BYTES.subarray(300, 600), BYTES.subarray(600)]
      const deliveries = chunks.map(() => deferred<Buffer>())
      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          headers: new Headers(),
          body: (async function* () {
            for (const delivery of deliveries) yield await delivery.promise
          })()
        })
      )
      const slow = fetchPackage([PKG], expectedFor(), onProgress)
      for (const [i, chunk] of chunks.entries()) {
        await vi.advanceTimersByTimeAsync(MINI_APP_DOWNLOAD_IDLE_MS - 1000)
        seen = acked()
        deliveries[i].resolve(chunk)
        await seen
      }

      const pkg = await slow
      expect(fs.readFileSync(pkg.path).equals(BYTES)).toBe(true)
      await pkg.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never sends the session credentials and never follows a redirect', async () => {
    // `redirect: 'error'` IS the origin pin at the transport: a 302 from the pinned host
    // to an attacker's would otherwise be followed with the pin already satisfied.
    fetch.mockResolvedValueOnce(streamed([BYTES]).res)

    await fetchPackage([PKG], expectedFor())

    expect(fetch).toHaveBeenCalledWith(PKG, expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
  })

  it('reports progress as the bytes land, against the declared size', async () => {
    fetch.mockResolvedValueOnce(streamed([BYTES.subarray(0, 256), BYTES.subarray(256)]).res)
    const seen: number[] = []

    await fetchPackage([PKG], expectedFor(), (received, total) => seen.push(received / total))

    expect(seen).toEqual([0.25, 1])
  })

  it('refuses bytes whose hash is not the one the reviewed manifest carries', async () => {
    // The supply-chain gate itself: size and origin can match while the content does
    // not. Nothing may be left on disk for the caller to pick up by mistake.
    fetch.mockResolvedValueOnce(streamed([BYTES]).res)

    await expect(fetchPackage([PKG], expectedFor({ sha256: 'b'.repeat(64) }))).rejects.toThrow(/hash mismatch/i)
    expect(fs.readdirSync(temp)).toEqual([])
  })

  it('refuses a body shorter than declared', async () => {
    // A truncated download that hashes to something else already fails on the hash;
    // this pins the SIZE contract so the message says which it was.
    fetch.mockResolvedValueOnce(streamed([BYTES.subarray(0, 512)]).res)

    await expect(fetchPackage([PKG], expectedFor())).rejects.toThrow(/size mismatch/i)
  })

  it('stops reading the moment the body runs past the declared size', async () => {
    // `Content-Length` is attacker-controlled, so the running count is the real cap.
    // Stopping MID-STREAM is the point: a check after the loop has already spent the disk.
    const { res, served } = streamed([BYTES, Buffer.alloc(1), Buffer.alloc(1)])
    fetch.mockResolvedValueOnce(res)

    await expect(fetchPackage([PKG], expectedFor())).rejects.toThrow(/exceeds the declared/i)
    expect(served.count).toBe(2)
    expect(fs.readdirSync(temp)).toEqual([])
  })

  it('rejects on an over-declared Content-Length without reading a byte', async () => {
    const { res, served } = streamed([BYTES], { 'content-length': String(BYTES.byteLength + 1) })
    fetch.mockResolvedValueOnce(res)

    await expect(fetchPackage([PKG], expectedFor())).rejects.toThrow(/advertises/i)
    expect(served.count).toBe(0)
  })

  it('refuses a manifest that declares a package over the size cap before requesting it', async () => {
    await expect(fetchPackage([PKG], expectedFor({ size: MINI_APP_MAX_PACKAGE_BYTES + 1 }))).rejects.toThrow(
      /over the .* limit/i
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a plain-http package url even when its origin is pinned', async () => {
    await expect(
      fetchPackage(['http://example.com/1.0.0.miniapp'], expectedFor({ ...expectedFor(), size: 1024 }))
    ).rejects.toThrow(/https/i)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('fetchIcon', () => {
  const ICON_URL = 'https://example.com/icon.png'
  const bytes = Buffer.from('PNG-bytes')
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  const iconBody = (chunks: Buffer[]) => ({
    ok: true,
    body: (async function* () {
      for (const chunk of chunks) yield chunk
    })()
  })

  it('hands back the bytes when they match the digest the manifest carries', async () => {
    fetch.mockResolvedValueOnce(iconBody([bytes]))

    await expect(fetchIcon(ICON_URL, { sha256: digest, origins: ['https://example.com'] })).resolves.toEqual(bytes)
    expect(fetch).toHaveBeenCalledWith(ICON_URL, expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
  })

  it('refuses bytes whose hash is not the one the manifest carries', async () => {
    // The card must never show a face the package cannot prove.
    fetch.mockResolvedValueOnce(iconBody([bytes]))

    await expect(fetchIcon(ICON_URL, { sha256: 'b'.repeat(64), origins: ['https://example.com'] })).rejects.toThrow(
      /hash mismatch/i
    )
  })

  it('refuses an icon url outside the pinned origins before any request is made', async () => {
    await expect(
      fetchIcon('https://evil.example/icon.png', { sha256: digest, origins: ['https://example.com'] })
    ).rejects.toThrow(/pinned/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops reading the moment the body runs past the icon cap', async () => {
    // Six 1 MB chunks against a 5 MB cap: the hash is never even computed.
    let yielded = 0
    fetch.mockResolvedValueOnce({
      ok: true,
      body: (async function* () {
        for (let i = 0; i < 6; i++) {
          yielded += 1
          yield Buffer.alloc(1024 * 1024)
        }
      })()
    })

    await expect(fetchIcon(ICON_URL, { sha256: digest, origins: ['https://example.com'] })).rejects.toThrow(
      /byte limit/i
    )
    expect(yielded).toBeLessThan(6 + 1)
  })
})
