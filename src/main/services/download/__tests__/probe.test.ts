import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { probeDownload } from '../probe'

const CONTENT = Buffer.alloc(64 * 1024, 7)

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer((request, response) => {
    const mode = request.url?.split('/')[1]

    if (mode === 'no-head') {
      if (request.method === 'HEAD') {
        response.writeHead(405).end()
        return
      }
      response.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${CONTENT.length}`,
        'content-length': '1'
      })
      response.end(CONTENT.subarray(0, 1))
      return
    }

    if (mode === 'plain') {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': String(CONTENT.length)
      })
      response.end(CONTENT)
      return
    }

    if (mode === 'lying') {
      // Advertises range support but always answers with the full body.
      const body = request.method === 'HEAD' ? undefined : CONTENT
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(CONTENT.length),
        'accept-ranges': 'bytes',
        etag: '"v1"'
      })
      response.end(body)
      return
    }

    if (mode === 'unknown-total' || mode === 'unknown-total-with-head') {
      if (request.method === 'HEAD') {
        if (mode === 'unknown-total') {
          response.writeHead(405).end()
        } else {
          response.writeHead(200, {
            'content-length': String(CONTENT.length),
            'accept-ranges': 'bytes'
          })
          response.end()
        }
        return
      }
      response.writeHead(206, {
        'content-range': 'bytes 0-0/*',
        'content-length': '1'
      })
      response.end(CONTENT.subarray(0, 1))
      return
    }

    // Default: a well-behaved range server.
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(CONTENT.length),
        'accept-ranges': 'bytes',
        etag: '"v1"',
        'last-modified': 'Mon, 19 Oct 2026 00:00:00 GMT'
      })
      response.end()
      return
    }
    const range = /bytes=(\d+)-(\d+)/.exec(String(request.headers.range))
    const start = range ? Number(range[1]) : 0
    const end = range ? Math.min(Number(range[2]), CONTENT.length - 1) : CONTENT.length - 1
    response.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${CONTENT.length}`,
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      etag: '"v1"'
    })
    response.end(CONTENT.subarray(start, end + 1))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('probeDownload', () => {
  it('reads size, range support and validators from HEAD', async () => {
    const probe = await probeDownload(`${baseUrl}/range`, fetch)

    expect(probe.supportsRanges).toBe(true)
    expect(probe.totalBytes).toBe(CONTENT.length)
    expect(probe.etag).toBe('"v1"')
    expect(probe.mime).toBe('application/octet-stream')
  })

  it('falls back to a one-byte range when HEAD is rejected', async () => {
    const probe = await probeDownload(`${baseUrl}/no-head`, fetch)

    expect(probe.supportsRanges).toBe(true)
    expect(probe.totalBytes).toBe(CONTENT.length)
  })

  it('reports that ranges are unsupported when the server serves the whole body', async () => {
    const probe = await probeDownload(`${baseUrl}/plain`, fetch)

    expect(probe.supportsRanges).toBe(false)
    expect(probe.totalBytes).toBe(CONTENT.length)
  })

  it('does not trust Accept-Ranges without a 206 answer', async () => {
    const probe = await probeDownload(`${baseUrl}/lying`, fetch)

    expect(probe.supportsRanges).toBe(false)
    expect(probe.totalBytes).toBe(CONTENT.length)
    expect(probe.etag).toBe('"v1"')
  })

  it('keeps the total unknown when Content-Range ends in *', async () => {
    const probe = await probeDownload(`${baseUrl}/unknown-total`, fetch)

    expect(probe.supportsRanges).toBe(false)
    expect(probe.totalBytes).toBe(0)
  })

  it('keeps HEAD length but drops segmentation when the range total is unknown', async () => {
    const probe = await probeDownload(`${baseUrl}/unknown-total-with-head`, fetch)

    expect(probe.supportsRanges).toBe(false)
    expect(probe.totalBytes).toBe(CONTENT.length)
  })
})
