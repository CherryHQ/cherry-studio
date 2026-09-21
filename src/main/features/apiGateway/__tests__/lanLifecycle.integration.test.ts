import type * as os from 'node:os'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

const stream = vi.hoisted(() => ({ controller: undefined as ReadableStreamDefaultController<Uint8Array> | undefined }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  const preferences = MockMainPreferenceServiceExport.preferenceService
  return mockApplicationFactory({
    PreferenceService: {
      ...preferences,
      getMultiple: (keys: Record<string, UnifiedPreferenceKeyType>) =>
        Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, preferences.get(key)]))
    }
  })
})

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  networkInterfaces: () => ({ en0: [{ address: '192.168.1.8', family: 'IPv4', internal: false }] })
}))

// Keep real listening sockets and a live response; AI generation is irrelevant to listener isolation.
vi.mock('../app', async () => {
  const { Elysia } = await import('elysia')
  const { node } = await import('@elysia/node')
  return {
    buildApp: () =>
      new Elysia({ adapter: node() })
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

describe('independent LAN listener lifecycle', () => {
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
      const { port: lanPort } = service.createPairingOffer()
      expect(lanPort).not.toBe(localPort)
      const lanResponse = await fetch(`http://127.0.0.1:${lanPort}/health`)
      expect(await lanResponse.text()).toBe('ok')

      await service.setLanEnabled(false)

      stream.controller!.enqueue(new TextEncoder().encode('after'))
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('after')
      const localResponse = await fetch(`${localOrigin}/health`)
      expect(await localResponse.text()).toBe('ok')
      expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '127.0.0.1' })
      await expect(fetch(`http://127.0.0.1:${lanPort}/health`)).rejects.toThrow()
    } finally {
      await reader?.cancel().catch(() => {})
      await service._doDestroy()
    }
  }, 15_000)
})
