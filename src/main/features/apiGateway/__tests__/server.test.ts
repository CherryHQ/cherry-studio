import { createServer, type Server as HttpServer } from 'node:http'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Server lifecycle tests for `ApiGateway` (start/stop) against the real
 * `@elysia/node` adapter on an ephemeral port. Restart at the service level is
 * `ApiGatewayService.restart()` (deactivate+activate, constructing a fresh
 * `ApiGateway` each cycle) — exercised via "can start again after stop" below.
 *
 * Regression guard for the bug where `stop()` called `app.stop()` — which throws
 * "Elysia isn't running" under the node adapter (it never assigns `app.server`).
 * That unhandled throw left the gateway stuck and unable to restart in-process.
 */

const mocks = vi.hoisted(() => ({
  buildApp: vi.fn(),
  port: 0,
  setPreference: vi.fn<(key: string, value: unknown) => Promise<void>>(async () => undefined)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      // port 0 => OS picks a free port, so tests never collide.
      get: (key: string) => (key.endsWith('port') ? mocks.port : '127.0.0.1'),
      set: mocks.setPreference
    }
  })
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

// Build a minimal node-adapter app so these tests exercise the server lifecycle,
// not the route plugins (which pull in heavy services).
vi.mock('../app', async () => {
  const { Elysia } = await import('elysia')
  const { node } = await import('@elysia/node')
  mocks.buildApp.mockImplementation(() => new Elysia({ adapter: node() }).get('/health', () => 'ok'))
  return { buildApp: mocks.buildApp }
})

import { ApiGateway } from '../server'

const rawServer = (gateway: ApiGateway): HttpServer =>
  (gateway as unknown as { serverInfo: { raw: { node: { server: HttpServer } } } }).serverInfo.raw.node.server

const portOf = (gateway: ApiGateway): number => (rawServer(gateway).address() as { port: number }).port

const listen = (server: HttpServer, port = 0): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })

const close = (server: HttpServer): Promise<void> =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))

describe('ApiGateway server lifecycle', () => {
  let gateway: ApiGateway | null = null
  const extraGateways: ApiGateway[] = []
  const occupiedServers: HttpServer[] = []

  beforeEach(() => {
    mocks.port = 0
    mocks.buildApp.mockClear()
    mocks.setPreference.mockClear()
  })

  afterEach(async () => {
    await gateway?.stop().catch(() => {})
    gateway = null
    await Promise.all(extraGateways.splice(0).map((item) => item.stop().catch(() => {})))
    await Promise.all(occupiedServers.splice(0).map((server) => close(server).catch(() => {})))
  })

  it('starts and reports running', async () => {
    gateway = new ApiGateway()
    await gateway.start()
    expect(gateway.isRunning()).toBe(true)
  })

  it('reuses the current listener for concurrent and repeated starts', async () => {
    gateway = new ApiGateway()

    await Promise.all([gateway.start(), gateway.start()])
    await gateway.start()

    expect(gateway.isRunning()).toBe(true)
    expect(mocks.buildApp).toHaveBeenCalledTimes(1)
  })

  it('selects and persists an available port when an external process owns the configured port', async () => {
    const external = createServer((_request, response) => response.end('external'))
    occupiedServers.push(external)
    const occupiedPort = await listen(external)
    mocks.port = occupiedPort
    gateway = new ApiGateway()
    let finishPersist: (() => void) | undefined
    mocks.setPreference.mockImplementationOnce(() => new Promise<void>((resolve) => (finishPersist = resolve)))

    const firstStart = gateway.start()
    await vi.waitFor(() => expect(mocks.setPreference).toHaveBeenCalledOnce())
    let secondStartSettled = false
    const secondStart = gateway.start().then(() => {
      secondStartSettled = true
    })
    await Promise.resolve()
    expect(secondStartSettled).toBe(false)
    finishPersist?.()
    await Promise.all([firstStart, secondStart])

    const fallbackPort = portOf(gateway)
    expect(fallbackPort).not.toBe(occupiedPort)
    expect(mocks.setPreference).toHaveBeenCalledWith('feature.api_gateway.port', fallbackPort)
    await expect(fetch(`http://127.0.0.1:${fallbackPort}/health`).then((response) => response.text())).resolves.toBe(
      'ok'
    )
    await expect(fetch(`http://127.0.0.1:${occupiedPort}`).then((response) => response.text())).resolves.toBe(
      'external'
    )
  })

  it('does not reuse a gateway owned by another instance', async () => {
    gateway = new ApiGateway()
    await gateway.start()
    const firstPort = portOf(gateway)
    mocks.port = firstPort

    const otherGateway = new ApiGateway()
    extraGateways.push(otherGateway)
    await otherGateway.start()

    const fallbackPort = portOf(otherGateway)
    expect(fallbackPort).not.toBe(firstPort)
    expect(gateway.isRunning()).toBe(true)
    expect(otherGateway.isRunning()).toBe(true)
    expect(mocks.setPreference).toHaveBeenCalledWith('feature.api_gateway.port', fallbackPort)
  })

  it('stops without throwing and reports not running', async () => {
    gateway = new ApiGateway()
    await gateway.start()
    await expect(gateway.stop()).resolves.toBeUndefined()
    expect(gateway.isRunning()).toBe(false)
  })

  it('can start again after stop (not stuck)', async () => {
    gateway = new ApiGateway()
    await gateway.start()
    await gateway.stop()
    await expect(gateway.start()).resolves.toBeUndefined()
    expect(gateway.isRunning()).toBe(true)
  })

  it('stop() before start is a no-op', async () => {
    gateway = new ApiGateway()
    await expect(gateway.stop()).resolves.toBeUndefined()
    expect(gateway.isRunning()).toBe(false)
  })
})
