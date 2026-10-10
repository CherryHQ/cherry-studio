import { afterEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      // port 0 => OS picks a free port, so tests never collide.
      get: (key: string) => (key.endsWith('port') ? 0 : '127.0.0.1')
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
  return { buildApp: () => new Elysia({ adapter: node() }).get('/health', () => 'ok') }
})

import { ApiGateway } from '../server'

describe('ApiGateway server lifecycle', () => {
  let gateway: ApiGateway | null = null

  afterEach(async () => {
    await gateway?.stop().catch(() => {})
    gateway = null
  })

  it('starts and reports running', async () => {
    gateway = new ApiGateway()
    await gateway.start()
    expect(gateway.isRunning()).toBe(true)
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
