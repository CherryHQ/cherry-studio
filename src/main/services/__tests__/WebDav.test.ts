import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// WebDav only touches the logger on failures; the real service would drag the
// whole logger pipeline into this test for no coverage gain.
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

import WebDav from '../WebDav'

// import.meta.url (not __dirname) keeps module init valid under pure-ESM pools.
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures', import.meta.url))
const SELF_SIGNED_KEY = readFileSync(`${FIXTURES_DIR}/self-signed-key.pem`, 'utf-8')
const SELF_SIGNED_CERT = readFileSync(`${FIXTURES_DIR}/self-signed-cert.pem`, 'utf-8')

// Any HTTP response (even 404) is enough: the TLS handshake happens before
// HTTP semantics, which is exactly the layer under test.
function createTlsServer(): Promise<{ server: https.Server; port: number }> {
  return new Promise((resolve) => {
    const server = https.createServer(
      {
        key: SELF_SIGNED_KEY,
        cert: SELF_SIGNED_CERT
      },
      (_req, res) => {
        res.statusCode = 404
        res.end()
      }
    )
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port })
    })
  })
}

function createPlainHttpServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 404
      res.end()
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port })
    })
  })
}

const closeServer = (server: https.Server | http.Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()))

describe('WebDav TLS verification', () => {
  let servers: Array<https.Server | http.Server>

  beforeEach(() => {
    servers = []
  })
  afterEach(async () => {
    await Promise.all(servers.map(closeServer))
  })

  it('rejects a self-signed certificate by default (fail-closed)', async () => {
    const { server, port } = await createTlsServer()
    servers.push(server)
    const webdav = new WebDav({ webdavHost: `https://127.0.0.1:${port}` })

    // The raw chain-trust message must survive the client layer: the renderer
    // matcher classifies on this text to surface the opt-in guidance.
    await expect(webdav.checkConnection()).rejects.toThrow(/self-signed certificate/i)
  })

  it('accepts the self-signed certificate when allowSelfSignedTls is opted in', async () => {
    const { server, port } = await createTlsServer()
    servers.push(server)
    const webdav = new WebDav({
      webdavHost: `https://127.0.0.1:${port}`,
      allowSelfSignedTls: true
    })

    // Handshake succeeds; the stub server answers 404 so exists() resolves false.
    await expect(webdav.checkConnection()).resolves.toBe(false)
  })

  it('is unaffected for plain-http hosts (agent only serves https)', async () => {
    const { server, port } = await createPlainHttpServer()
    servers.push(server)
    const webdav = new WebDav({ webdavHost: `http://127.0.0.1:${port}` })

    await expect(webdav.checkConnection()).resolves.toBe(false)
  })

  it('keeps opt-in plain-http hosts off the verification-skipping agent', async () => {
    // Opting into self-signed TLS must not reroute http traffic through the
    // https agent — that would fail the handshake here.
    const { server, port } = await createPlainHttpServer()
    servers.push(server)
    const webdav = new WebDav({
      webdavHost: `http://127.0.0.1:${port}`,
      allowSelfSignedTls: true
    })

    await expect(webdav.checkConnection()).resolves.toBe(false)
  })

  it('treats allowSelfSignedTls: false the same as unset (verifies)', async () => {
    const { server, port } = await createTlsServer()
    servers.push(server)
    const webdav = new WebDav({
      webdavHost: `https://127.0.0.1:${port}`,
      allowSelfSignedTls: false
    })

    await expect(webdav.checkConnection()).rejects.toThrow(/self-signed certificate/i)
  })
})
