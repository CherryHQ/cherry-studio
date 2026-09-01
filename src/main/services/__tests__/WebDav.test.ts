/**
 * WebDav failure-contract tests (issue #10512).
 *
 * A real local HTTP server drives the actual `webdav` client, so the
 * `.status`-bearing error shape reaching `describeWebDavError` is the exact
 * production shape — a stubbed client would only pin our wrapper.
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebDAVClient } from 'webdav'

import WebDav from '../WebDav'

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void

describe('WebDav failure contracts', () => {
  let server: Server
  let baseUrl: string
  let handler: RequestHandler
  let seenRequests: Array<{ method?: string; url?: string }>

  beforeEach(async () => {
    seenRequests = []
    handler = () => {}
    server = http.createServer((req, res) => {
      seenRequests.push({ method: req.method, url: req.url })
      handler(req, res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    mockMainLoggerService.error.mockClear()
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.restoreAllMocks()
  })

  it('rethrows PUT failures with HTTP status, stage, and remote path', async () => {
    // Bug caught: the raw status used to be discarded at the WebDav boundary,
    // collapsing every server rejection into an unclassifiable message.
    handler = (req, res) => {
      if (req.method === 'PUT') {
        res.writeHead(507)
        res.end('quota exceeded, token=abc123 leaked')
        return
      }
      if (req.method === 'MKCOL') {
        res.writeHead(201)
        res.end()
        return
      }
      res.writeHead(404)
      res.end()
    }

    const webdav = new WebDav({ webdavHost: baseUrl, webdavPath: '/backups' })
    const error: unknown = await webdav.putFileContents('backup.zip', Buffer.from('x'), { overwrite: true }).then(
      () => null,
      (e) => e
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/WebDAV PUT \/backups\/backup\.zip failed: HTTP 507/)
    // Original error stays reachable for the main-process log chain.
    expect((error as Error).cause).toBeInstanceOf(Error)
    // The response body never enters the thrown message — log-only.
    expect((error as Error).message).not.toMatch(/quota/)
    // Body reaches the error log redacted: embedded credentials masked.
    const logCall = mockMainLoggerService.error.mock.calls.find((call) =>
      String(call[0]).includes('putting file contents')
    )
    expect(logCall).toBeDefined()
    const context = logCall?.[2] as { bodySnippet?: string }
    expect(context.bodySnippet).toContain('token="<redacted>"')
    expect(context.bodySnippet).not.toContain('abc123')
  })

  it('carries stage and path when the ensure-directory step fails', async () => {
    // Bug caught: an MKCOL rejection surfaced with no indication of which
    // stage failed — indistinguishable from a PUT failure.
    handler = (req, res) => {
      if (req.method === 'PROPFIND') {
        res.writeHead(404)
        res.end()
        return
      }
      if (req.method === 'MKCOL') {
        res.writeHead(403)
        res.end()
        return
      }
      res.writeHead(405)
      res.end()
    }

    const webdav = new WebDav({ webdavHost: baseUrl, webdavPath: '/backups' })
    await expect(webdav.putFileContents('backup.zip', Buffer.from('x'), { overwrite: true })).rejects.toThrow(
      /WebDAV ensure directory \/backups failed: HTTP 403/
    )
  })

  it('passes non-status failures through unwrapped (TLS/timeout matcher input)', async () => {
    // Bug caught: wrapping every rejection would destroy the renderer's
    // raw-text classification, which keys on the original message.
    const webdav = new WebDav({ webdavHost: 'https://example.com' })
    const tlsError = new Error('self-signed certificate')
    const timeoutError = new DOMException('Idle timeout exceeded', 'TimeoutError')
    webdav.instance = {
      exists: vi.fn().mockRejectedValueOnce(tlsError).mockRejectedValueOnce(timeoutError),
      createDirectory: vi.fn()
    } as unknown as WebDAVClient

    const first: unknown = await webdav.putFileContents('f.zip', Buffer.from('x')).then(
      () => null,
      (e) => e
    )
    const second: unknown = await webdav.putFileContents('f.zip', Buffer.from('x')).then(
      () => null,
      (e) => e
    )

    expect(first).toBe(tlsError)
    expect(second).toBe(timeoutError)
    expect((second as Error).message).not.toMatch(/HTTP/)
  })

  it('checkConnection probes the configured path, not the server root', async () => {
    // Bug caught: probing '/' made the button green even when the configured
    // backup path was gone — the "connection OK but backup fails" contradiction.
    handler = (_req, res) => {
      res.writeHead(404)
      res.end()
    }

    const webdav = new WebDav({ webdavHost: baseUrl, webdavPath: '/backups' })
    await expect(webdav.checkConnection()).resolves.toBe(false)
    expect(seenRequests).toContainEqual({ method: 'PROPFIND', url: '/backups' })
    expect(seenRequests.some((r) => r.url === '/')).toBe(false)
  })

  it('checkConnection still probes the root when no path is configured', async () => {
    handler = (_req, res) => {
      res.writeHead(404)
      res.end()
    }

    const webdav = new WebDav({ webdavHost: baseUrl })
    await expect(webdav.checkConnection()).resolves.toBe(false)
    expect(seenRequests).toContainEqual({ method: 'PROPFIND', url: '/' })
  })
})
