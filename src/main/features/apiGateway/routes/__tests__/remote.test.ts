import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { node } from '@elysia/node'
import { Elysia } from 'elysia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

import {
  type ChannelOptions,
  connectSecureChannel,
  createDeviceIdentity,
  deviceIdentityId,
  RemoteSocketStream
} from '@cherrystudio/remote-transport'
import { BaseService } from '@main/core/lifecycle'

const desktopIdentity = vi.hoisted(() => ({ bytes: undefined as Uint8Array | undefined }))
const service = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('@main/services/remoteAccess/deviceIdentity', () => ({
  loadDesktopIdentity: async () => desktopIdentity.bytes
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const factory = mockApplicationFactory()
  const get = factory.application.get.bind(factory.application)
  factory.application.get = ((name: string) =>
    name === 'RemoteAccessService' ? service.current : get(name)) as typeof factory.application.get
  return factory
})

import { RemoteAccessService } from '@main/services/remoteAccess'

import { remoteRoutes } from '../remote'

type Logger = ReturnType<ChannelOptions['logger']['forComponent']>
const silent = (): Logger => Object.assign(() => {}, { error() {}, trace() {}, enabled: false, newScope: silent })
const logger: ChannelOptions['logger'] = { forComponent: silent }

describe('remote ws route', () => {
  let http: Server | undefined
  let port: number

  beforeEach(async () => {
    BaseService.resetInstances()
    desktopIdentity.bytes = await createDeviceIdentity()
    service.current = new RemoteAccessService()
    const app = new Elysia({ adapter: node() }).use(remoteRoutes)
    type Info = { raw?: { ready?: () => Promise<unknown>; node?: { server?: Server } } }
    const info = await new Promise<Info>((resolve) => app.listen({ port: 0, hostname: '127.0.0.1' }, resolve))
    // The listen callback fires before the socket is bound; `ready()` settles once it is.
    await info.raw?.ready?.()
    http = info.raw?.node?.server
    if (!http) throw new Error('Expected Node HTTP server')
    port = (http.address() as AddressInfo).port
  })

  afterEach(async () => {
    ;(service.current as RemoteAccessService).closeIngress()
    await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()))
  })

  it('upgrades a paired device and answers hello through the Noise channel', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/remote/connect`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const channel = await connectSecureChannel(new RemoteSocketStream(socket, silent(), 'outbound'), {
      identity: await createDeviceIdentity(),
      logger,
      protocolVersions: [1],
      remoteIdentity: deviceIdentityId(desktopIdentity.bytes!),
      signal: AbortSignal.timeout(5000)
    })
    await channel.write({ jsonrpc: '2.0', id: 1, method: 'connection.hello', params: { protocolVersions: [1] } })
    expect(await channel.read(AbortSignal.timeout(5000))).toMatchObject({ id: 1, result: { protocolVersion: 1 } })
    await channel.close()
  })

  it('allows native clients that include an Origin header', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/remote/connect`, { origin: 'http://192.168.1.8' })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.close()
    })
  })
})
