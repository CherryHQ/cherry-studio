import { createServer, type ListenOptions, Server } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

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
      get: (key: string) => {
        if (key === 'app.language') return 'en-US'
        return key.endsWith('port') ? 0 : '127.0.0.1'
      }
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

import { ApiGatewayService } from '../ApiGatewayService'
import { mapGatewayBindError } from '../bindError'
import { ApiGateway } from '../server'

describe('ApiGateway server lifecycle', () => {
  let gateway: ApiGateway | null = null
  let service: ApiGatewayService | null = null

  beforeEach(() => BaseService.resetInstances())

  afterEach(async () => {
    await service?._doStop()
    service = null
    await gateway?.stop().catch(() => {})
    gateway = null
    vi.restoreAllMocks()
  })

  it.each([1, 3])('releases real listeners after %i controlled internal IPv6 refusals', async (refusals) => {
    const listen = Server.prototype.listen
    const refusedPorts: number[] = []
    vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
      this: Server,
      ...args: Parameters<Server['listen']>
    ) {
      const options = args[0] as ListenOptions
      if (options.host === '::1' && refusedPorts.length < refusals) {
        refusedPorts.push(options.port!)
        const error = Object.assign(new Error('controlled IPv6 listen refusal'), {
          code: 'EACCES',
          syscall: 'listen',
          address: '::1',
          port: options.port
        })
        queueMicrotask(() => this.emit('error', error))
        return this
      }
      return Reflect.apply(listen, this, args)
    })
    service = new ApiGatewayService()
    if (refusals === 3) {
      await expect(service.ensureInternalGateway()).rejects.toMatchObject({
        message: expect.stringContaining('internal API Gateway'),
        cause: expect.objectContaining({ code: 'EACCES', address: '::1' })
      })
      expect(service.getInternalGatewayOrigin()).toBeUndefined()
    } else {
      const { baseUrl } = await service.ensureInternalGateway()
      expect(await (await fetch(`${baseUrl}/health`)).text()).toBe('ok')
    }
    expect(refusedPorts).toHaveLength(refusals)
    await service._doStop()
    vi.restoreAllMocks()
    for (const port of new Set(refusedPorts)) {
      gateway = new ApiGateway({ host: '127.0.0.1', port })
      await gateway.start()
      expect(await (await fetch(`http://127.0.0.1:${port}/health`)).text()).toBe('ok')
      await gateway.stop()
    }
  })

  it('preserves real OS EACCES fields, releases failed listeners, and permits a fresh allowed start', async (context) => {
    gateway = new ApiGateway({ host: '127.0.0.1', port: 1001 })
    try {
      await gateway.start()
    } catch (error) {
      expect(error).toMatchObject({ code: 'EACCES', syscall: 'listen', address: '127.0.0.1', port: 1001 })
      expect(gateway.isRunning()).toBe(false)
      expect(gateway.getHosts()).toEqual([])
      const diagnostic = mapGatewayBindError(error, { host: '127.0.0.1', port: 1001 }, 'public') as Error
      expect(diagnostic.message).toContain('refused permission')
      expect(diagnostic.cause).toBe(error)
      gateway = new ApiGateway({ host: '127.0.0.1', port: 0 })
      await gateway.start()
      expect(await (await fetch(`http://127.0.0.1:${gateway.getPort()}/health`)).text()).toBe('ok')
      return
    }
    await gateway.stop()
    context.skip('This platform permits binding TCP port 1001; no real privileged-port EACCES fixture')
  })

  it('keeps occupied-port failures as EADDRINUSE without permission recovery', async () => {
    const occupied = createServer()
    await new Promise<void>((resolve) => occupied.listen({ host: '127.0.0.1', port: 0 }, resolve))
    try {
      const address = occupied.address()
      if (!address || typeof address === 'string') throw new Error('TCP fixture has no address')
      const endpoint = { host: '127.0.0.1', port: address.port }
      gateway = new ApiGateway(endpoint)
      const error = await gateway.start().then(
        () => {
          throw new Error('Occupied port unexpectedly bound')
        },
        (error: unknown) => error
      )
      expect(error).toMatchObject({ code: 'EADDRINUSE', syscall: 'listen' })
      expect(mapGatewayBindError(error, endpoint, 'public')).toBe(error)
      expect(gateway.isRunning()).toBe(false)
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('reports a controlled second-bind IPv6 refusal with its assigned port and releases IPv4', async () => {
    const listen = Server.prototype.listen
    let refused: Error | undefined
    let assignedPort = 0
    vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
      this: Server,
      ...args: Parameters<Server['listen']>
    ) {
      const options = args[0] as ListenOptions
      if (options.host === '::1') {
        assignedPort = options.port!
        refused = Object.assign(new Error('controlled IPv6 listen refusal'), {
          code: 'EACCES',
          syscall: 'listen',
          address: '::1',
          port: assignedPort
        })
        queueMicrotask(() => this.emit('error', refused))
        return this
      }
      return Reflect.apply(listen, this, args)
    })
    const endpoint = { host: '127.0.0.1', port: 0 }
    gateway = new ApiGateway(endpoint)
    await expect(gateway.start()).rejects.toBeDefined()
    expect(assignedPort).toBeGreaterThan(0)
    expect(gateway.getHosts()).toEqual([])
    expect(gateway.isRunning()).toBe(false)
    const diagnostic = mapGatewayBindError(refused, endpoint, 'internal') as Error
    expect(diagnostic.message).toContain(`::1, requested TCP port ${assignedPort}`)
    expect(diagnostic.cause).toBe(refused)
    vi.restoreAllMocks()
    gateway = new ApiGateway({ host: '127.0.0.1', port: assignedPort })
    await gateway.start()
    expect(gateway.isRunning()).toBe(true)
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
