import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchTextVerified, streamToFileVerified, withMirrorFallback, writeFileAtomic } from '../downloadEngine'

const PAYLOAD = Buffer.from('local-model-download-engine-fixture')
// printf 'local-model-download-engine-fixture' | shasum -a 256
const PAYLOAD_SHA256 = 'e1ae4b3d3c1eb0f9a2c3ca6b0b0ea4b8ef2ec2b8e5c1cd39fdbbf0b8cd0a37a9'

let workDir: string

function streamResponse(content: Buffer) {
  return {
    ok: true,
    headers: { get: (h: string) => (h === 'content-length' ? String(content.length) : null) },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(content)
        controller.close()
      }
    })
  }
}

function textResponse(content: Buffer) {
  // Copy out of Buffer's pooled allocation — slicing its shared `buffer` from 0 would
  // hand back a different region entirely.
  return { ok: true, arrayBuffer: async () => new Uint8Array(content).buffer }
}

/** The real digest of PAYLOAD, computed the same way the engine does. */
async function payloadSha256(): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(PAYLOAD).digest('hex')
}

function atomicTempFilesFor(dest: string): string[] {
  return readdirSync(path.dirname(dest)).filter((entry) => entry.startsWith(`${path.basename(dest)}.tmp-`))
}

describe('withMirrorFallback', () => {
  const signal = new AbortController().signal

  it('returns the first mirror that succeeds without trying the rest', async () => {
    const attempt = vi.fn(async (url: string) => url)

    const result = await withMirrorFallback(['a', 'b'], signal, 'fixture', attempt)

    expect(result).toBe('a')
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('moves to the next mirror when one fails, and returns its result', async () => {
    const attempt = vi.fn(async (url: string) => {
      if (url === 'a') throw new Error('unreachable')
      return url
    })

    await expect(withMirrorFallback(['a', 'b'], signal, 'fixture', attempt)).resolves.toBe('b')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('throws the last mirror error once every mirror has failed', async () => {
    const attempt = vi.fn(async (url: string) => {
      throw new Error(`failed ${url}`)
    })

    await expect(withMirrorFallback(['a', 'b'], signal, 'fixture', attempt)).rejects.toThrow('failed b')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('stops at the first attempt once the download is aborted, instead of re-issuing it per mirror', async () => {
    const controller = new AbortController()
    const attempt = vi.fn(async () => {
      controller.abort()
      throw new Error('aborted')
    })

    await expect(withMirrorFallback(['a', 'b', 'c'], controller.signal, 'fixture', attempt)).rejects.toThrow('aborted')
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})

describe('streamToFileVerified', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workDir = mkdtempSync(path.join(tmpdir(), 'download-engine-test-'))
  })

  afterEach(() => rmSync(workDir, { recursive: true, force: true }))

  it('writes the file once the digest matches, creating missing parent directories', async () => {
    vi.mocked(net.fetch).mockImplementation((async () => streamResponse(PAYLOAD)) as unknown as typeof net.fetch)
    const dest = path.join(workDir, 'nested', 'weights.onnx')

    await streamToFileVerified('https://mirror/weights.onnx', dest, {
      sha256: await payloadSha256(),
      signal: new AbortController().signal
    })

    expect(readFileSync(dest)).toEqual(PAYLOAD)
    expect(atomicTempFilesFor(dest)).toEqual([])
  })

  it('replaces an existing target with the verified bytes', async () => {
    vi.mocked(net.fetch).mockImplementation((async () => streamResponse(PAYLOAD)) as unknown as typeof net.fetch)
    const dest = path.join(workDir, 'weights.onnx')
    writeFileSync(dest, 'undersized')

    await streamToFileVerified('https://mirror/weights.onnx', dest, {
      sha256: await payloadSha256(),
      signal: new AbortController().signal
    })

    expect(readFileSync(dest)).toEqual(PAYLOAD)
    expect(atomicTempFilesFor(dest)).toEqual([])
  })

  it('rejects a body whose digest does not match and leaves nothing behind', async () => {
    vi.mocked(net.fetch).mockImplementation((async () =>
      streamResponse(Buffer.from('corrupted'))) as unknown as typeof net.fetch)
    const dest = path.join(workDir, 'weights.onnx')

    await expect(
      streamToFileVerified('https://mirror/weights.onnx', dest, {
        sha256: await payloadSha256(),
        signal: new AbortController().signal
      })
    ).rejects.toThrow('sha256 mismatch')

    // Neither the final file nor the staging file may survive: a leftover would read as
    // an installed model on the next scan.
    expect(existsSync(dest)).toBe(false)
    expect(atomicTempFilesFor(dest)).toEqual([])
  })

  it('rejects a non-OK response without writing anything', async () => {
    vi.mocked(net.fetch).mockImplementation((async () => ({
      ok: false,
      status: 404,
      body: null,
      headers: { get: () => null }
    })) as unknown as typeof net.fetch)
    const dest = path.join(workDir, 'weights.onnx')

    await expect(
      streamToFileVerified('https://mirror/weights.onnx', dest, {
        sha256: PAYLOAD_SHA256,
        signal: new AbortController().signal
      })
    ).rejects.toThrow('HTTP 404')

    expect(existsSync(dest)).toBe(false)
  })

  it('reports progress ending at a full bar', async () => {
    vi.mocked(net.fetch).mockImplementation((async () => streamResponse(PAYLOAD)) as unknown as typeof net.fetch)
    const fractions: number[] = []

    await streamToFileVerified('https://mirror/weights.onnx', path.join(workDir, 'w.onnx'), {
      sha256: await payloadSha256(),
      signal: new AbortController().signal,
      onProgress: (fraction) => fractions.push(fraction)
    })

    expect(fractions.at(-1)).toBe(1)
    expect(fractions.every((fraction) => fraction >= 0 && fraction <= 1)).toBe(true)
  })
})

describe('fetchTextVerified', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the body when the digest matches', async () => {
    vi.mocked(net.fetch).mockImplementation((async () => textResponse(PAYLOAD)) as unknown as typeof net.fetch)

    await expect(
      fetchTextVerified('https://mirror/inference.yml', {
        sha256: await payloadSha256(),
        signal: new AbortController().signal
      })
    ).resolves.toBe(PAYLOAD.toString('utf8'))
  })

  it('rejects a body whose digest does not match', async () => {
    vi.mocked(net.fetch).mockImplementation((async () =>
      textResponse(Buffer.from('an error page'))) as unknown as typeof net.fetch)

    await expect(
      fetchTextVerified('https://mirror/inference.yml', {
        sha256: await payloadSha256(),
        signal: new AbortController().signal
      })
    ).rejects.toThrow('sha256 mismatch')
  })
})

describe('writeFileAtomic', () => {
  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'download-engine-atomic-test-'))
  })

  afterEach(() => rmSync(workDir, { recursive: true, force: true }))

  it('writes through a temp file that does not survive', async () => {
    const dest = path.join(workDir, 'nested', 'dict.txt')

    await writeFileAtomic(dest, 'entries')

    expect(readFileSync(dest, 'utf8')).toBe('entries')
    expect(atomicTempFilesFor(dest)).toEqual([])
  })
})
