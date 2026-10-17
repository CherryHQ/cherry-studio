import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const state = vi.hoisted(() => ({
  load: vi.fn<() => Promise<Uint8Array>>(),
  published: [] as Array<{ identity: string; port: number }>
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('../deviceIdentity', () => ({ loadDesktopIdentity: state.load }))
vi.mock('../RemoteAdvertisement', () => ({
  RemoteAdvertisement: class {
    update(identity: string, port: number) {
      state.published = [{ identity, port }]
    }
    stop() {
      state.published = []
    }
  }
}))

import { createDeviceIdentity, deviceIdentityId } from '@cherrystudio/remote-transport'

import { RemoteAccessService } from '../RemoteAccessService'

let service: RemoteAccessService
beforeEach(() => {
  BaseService.resetInstances()
  state.load.mockReset()
  state.published = []
  service = new RemoteAccessService()
})
afterEach(() => {
  service.closeIngress()
  BaseService.resetInstances()
})

it('cannot resurrect discovery after ingress closes while identity is loading', async () => {
  let loaded!: (value: Uint8Array) => void
  state.load.mockReturnValue(
    new Promise((resolve) => {
      loaded = resolve
    })
  )
  service.updateDirectEndpoint({ port: 24444 })
  service.closeIngress()
  loaded(await createDeviceIdentity())
  await Promise.resolve()
  await Promise.resolve()
  expect(state.published).toEqual([])
})

it('does not retry a failed identity on repeated listener snapshots, but recovers on an explicit invitation', async () => {
  state.load.mockRejectedValueOnce(new Error('Keychain unavailable'))
  service.updateDirectEndpoint({ port: 23333 })
  await vi.waitFor(() => expect(state.load).toHaveBeenCalledTimes(1))
  await Promise.resolve()
  service.updateDirectEndpoint({ port: 23333 })
  expect(state.load).toHaveBeenCalledTimes(1)
  const identity = await createDeviceIdentity()
  state.load.mockResolvedValue(identity)
  await service.createInvitation()
  expect(state.published).toEqual([{ identity: deviceIdentityId(identity), port: 23333 }])
})

it('publishes with LAN ingress and withdraws until it is enabled again', async () => {
  const identity = await createDeviceIdentity()
  state.load.mockResolvedValue(identity)
  service.updateDirectEndpoint(undefined)
  expect(state.published).toEqual([])
  service.updateDirectEndpoint({ port: 23333 })
  await vi.waitFor(() => expect(state.published).toEqual([{ identity: deviceIdentityId(identity), port: 23333 }]))
  service.closeIngress()
  expect(state.published).toEqual([])
  service.updateDirectEndpoint({ port: 24444 })
  await vi.waitFor(() => expect(state.published).toEqual([{ identity: deviceIdentityId(identity), port: 24444 }]))
})
