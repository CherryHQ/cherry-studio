import type * as os from 'node:os'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

import type { RemoteSocket } from '@cherrystudio/remote-transport'
import { BaseService } from '@main/core/lifecycle'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

const stream = vi.hoisted(() => ({ controller: undefined as ReadableStreamDefaultController<Uint8Array> | undefined }))
const connections = vi.hoisted(() => new Set<RemoteSocket>())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  const preferences = MockMainPreferenceServiceExport.preferenceService
  return mockApplicationFactory({
    PreferenceService: {
      ...preferences,
      getMultiple: (keys: Record<string, UnifiedPreferenceKeyType>) =>
        Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, preferences.get(key)]))
    },
    RemoteAccessService: {
      updateDirectEndpoint: vi.fn(),
      accept: (socket: RemoteSocket) => {
        connections.add(socket)
        socket.addEventListener('close', () => connections.delete(socket))
      },
      closeIngress: () => {
        for (const socket of connections) socket.close(1001, 'Remote access disabled')
      },
      createInvitation: async () => ({
        invitationId: 'invitation',
        invitationSecret: 'secret',
        expiresAt: '2026-09-22T00:02:00.000Z',
        desktopIdentity: '12D3KooWDesktop',
        protocolVersions: [1]
      })
    }
  } as never)
})

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  networkInterfaces: () => ({ en0: [{ address: '192.168.1.8', family: 'IPv4', internal: false }] })
}))

// Exercise the production routes and access guard on real sockets without invoking AI generation.
vi.mock('../app', async () => {
  const { Elysia } = await import('elysia')
  const { node } = await import('@elysia/node')
  const { screenLanRequest } = await import('../lanGuard')
  const { remoteRoutes } = await import('../routes/remote')
  return {
    buildApp: () =>
      new Elysia({ adapter: node() })
        .onRequest(({ request, set }) => {
          const failure = screenLanRequest(request, new URL(request.url).pathname)
          if (failure) {
            set.status = 403
            return failure
          }
          return undefined
        })
        .use(remoteRoutes)
        .get('/health', () => 'ok')
        .get(
          '/stream',
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  stream.controller = controller
                  controller.enqueue(new TextEncoder().encode('before'))
                }
              }),
              { headers: { 'content-type': 'text/event-stream' } }
            )
        )
  }
})

import { ApiGatewayService } from '../ApiGatewayService'
import type { ApiGateway } from '../server'

beforeEach(() => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
    'feature.api_gateway.enabled': true,
    'feature.api_gateway.host': '127.0.0.1',
    'feature.api_gateway.port': 0,
    'feature.api_gateway.api_key': 'existing-key'
  })
})

describe('shared Gateway listener lifecycle', () => {
  it('preserves a local stream and new local requests when LAN access is toggled', async () => {
    const service = new ApiGatewayService()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      await service._doInit()
      const localPort = (service as unknown as { apiGateway: ApiGateway }).apiGateway.getPort()
      const localOrigin = `http://127.0.0.1:${localPort}`
      const response = await fetch(`${localOrigin}/stream`)
      reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('before')

      await service.setLanEnabled(true)
      const { port: lanPort } = await service.createRemoteInvitation()
      expect(lanPort).toBe(localPort)
      const lanResponse = await fetch(`http://127.0.0.1:${lanPort}/health`)
      expect(await lanResponse.text()).toBe('ok')

      const socket = new WebSocket(`ws://127.0.0.1:${lanPort}/v1/remote/connect`)
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      const closed = new Promise<number>((resolve) => socket.once('close', resolve))
      await service.setLanEnabled(false)
      expect(await closed).toBe(1001)
      const rejected = new WebSocket(`ws://127.0.0.1:${lanPort}/v1/remote/connect`)
      await expect(new Promise((_, reject) => rejected.once('error', reject))).rejects.toThrow('403')

      stream.controller!.enqueue(new TextEncoder().encode('after'))
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('after')
      const localResponse = await fetch(`${localOrigin}/health`)
      expect(await localResponse.text()).toBe('ok')
      expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '127.0.0.1' })
      await service.setLanEnabled(true)
      expect((await service.createRemoteInvitation()).port).toBe(localPort)
    } finally {
      await reader?.cancel().catch(() => {})
      await service._doDestroy()
    }
  }, 15_000)

  it('reuses the configured Gateway port after restarting', async () => {
    const service = new ApiGatewayService()
    try {
      await service._doInit()
      const port = (service as unknown as { apiGateway: ApiGateway }).apiGateway.getPort()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.port', port)
      await service.setLanEnabled(true)
      await service.restart()
      expect((await service.createRemoteInvitation()).port).toBe(port)
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200)
    } finally {
      await service._doDestroy()
    }
  })
})
