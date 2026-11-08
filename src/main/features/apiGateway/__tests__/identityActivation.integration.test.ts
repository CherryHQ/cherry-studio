import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { createDeviceIdentity, deviceIdentityId } from '@cherrystudio/remote-transport'
import { BaseService } from '@main/core/lifecycle'
import { RemoteAccessService } from '@main/services/remoteAccess/RemoteAccessService'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

const keyStore = vi.hoisted(() => ({ syncAvailable: true }))
const storage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn<() => Promise<boolean>>(),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`sealed:${value}`)),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({
    result: value.toString('utf8').replace(/^sealed:/, ''),
    shouldReEncrypt: false
  })),
  isEncryptionAvailable: vi.fn(() => keyStore.syncAvailable),
  encryptString: vi.fn(() => {
    throw new Error('Forbidden synchronous encryption')
  }),
  decryptString: vi.fn(() => {
    throw new Error('Forbidden synchronous decryption')
  }),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret')
}))
const transport = vi.hoisted(() => ({
  published: [] as Array<{ identity: string; port: number; ipv6?: boolean }>,
  start: vi.fn()
}))

vi.mock('electron', () => ({ safeStorage: storage }))
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
vi.mock('@main/services/remoteAccess/RemoteAdvertisement', () => ({
  RemoteAdvertisement: class {
    update(identity: string, port: number, ipv6?: boolean) {
      transport.published.push({ identity, port, ipv6 })
    }
    stop() {}
  }
}))
vi.mock('../server', () => ({
  ApiGateway: class {
    private host?: string
    constructor(private readonly endpoint: { host: string; port: number }) {}
    async start() {
      transport.start()
      this.host = this.endpoint.host
    }
    async stop() {
      this.host = undefined
    }
    async rebind(host: string) {
      this.host = host
    }
    isRunning() {
      return this.host !== undefined
    }
    getHost() {
      return this.host
    }
    getHosts() {
      return this.host ? [this.host, this.host === '0.0.0.0' ? '::' : '::1'] : []
    }
    getPort() {
      return this.endpoint.port
    }
  }
}))

import { ApiGatewayService } from '../ApiGatewayService'

let directory: string
let service: ApiGatewayService
let remote: RemoteAccessService
let expectedIdentity: string
let resolveAvailability: (available: boolean) => void
let rejectAvailability: (error: Error) => void
let availabilitySettled: boolean

async function withinBudget<T>(action: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Activation exceeded the 1000 ms test budget')), 1000)
      }),
      action()
    ])
  } finally {
    clearTimeout(timer)
  }
}

function expectNoSynchronousStorage() {
  expect.soft(storage.isEncryptionAvailable).toHaveBeenCalledTimes(0)
  expect.soft(storage.encryptString).toHaveBeenCalledTimes(0)
  expect.soft(storage.decryptString).toHaveBeenCalledTimes(0)
}

beforeEach(async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  keyStore.syncAvailable = true
  BaseService.resetInstances()
  MockApplicationUtils.resetServices()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainCacheServiceUtils.resetMocks()
  vi.clearAllMocks()
  transport.published = []
  availabilitySettled = false
  storage.isAsyncEncryptionAvailable.mockReturnValue(
    new Promise<boolean>((resolve, reject) => {
      resolveAvailability = (available) => {
        availabilitySettled = true
        resolve(available)
      }
      rejectAvailability = (error) => {
        availabilitySettled = true
        reject(error)
      }
    })
  )
  directory = await mkdtemp(path.join(tmpdir(), 'gateway-identity-'))
  const identity = await createDeviceIdentity()
  expectedIdentity = deviceIdentityId(identity)
  await writeFile(path.join(directory, 'identity.enc'), `sealed:${Buffer.from(identity).toString('base64')}`)
  vi.mocked(application.getPath).mockImplementation((key: string) =>
    path.join(directory, key === 'feature.remote_access.identity_file' ? 'identity.enc' : 'identity.key')
  )
  MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
    'feature.api_gateway.enabled': false,
    'feature.api_gateway.host': '0.0.0.0',
    'feature.api_gateway.port': 49374,
    'feature.api_gateway.api_key': 'existing-key'
  })
  remote = new RemoteAccessService()
  MockApplicationUtils.setService('RemoteAccessService', remote)
  service = new ApiGatewayService()
})

afterEach(async () => {
  try {
    await service._doDestroy()
    remote.closeIngress()
    await remote._doDestroy()
    expectNoSynchronousStorage()
  } finally {
    MockApplicationUtils.resetServices()
    await rm(directory, { recursive: true, force: true })
    vi.restoreAllMocks()
  }
})

async function expectPendingIdentity(action: () => Promise<unknown>) {
  let heartbeat = false
  await withinBudget(async () => {
    await action()
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        heartbeat = true
        resolve()
      }, 0)
    )
  })
  expect(heartbeat).toBe(true)
  expect(service.isActivated).toBe(true)
  expect(service.isRunning()).toBe(true)
  const cache = application.get('CacheService')
  expect(cache.getShared('feature.api_gateway.running')).toBe(true)
  expect(cache.getShared('feature.api_gateway.lan_running')).toBe(true)
  expectNoSynchronousStorage()
  expect(storage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1)
  expect(availabilitySettled).toBe(false)
  expect.soft(cache.getShared('feature.remote_access.discovery_status')).toBe('starting')
  expect(transport.published).toEqual([])
}

describe('gateway activation with pending identity storage', () => {
  it.each(['enabled LAN boot', 'start with saved LAN host', 'loopback start then enable LAN'])(
    'finishes %s and schedules a heartbeat before identity is available',
    async (entry) => {
      if (entry === 'enabled LAN boot') {
        MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.enabled', true)
        await expectPendingIdentity(() => service._doInit())
      } else {
        if (entry === 'loopback start then enable LAN') {
          MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', '127.0.0.1')
        }
        await withinBudget(() => service._doInit())
        await expectPendingIdentity(async () => {
          await service.start()
          if (entry === 'loopback start then enable LAN') await service.setLanEnabled(true)
        })
      }
      resolveAvailability(true)
      await vi.waitFor(() =>
        expect(transport.published).toEqual([{ identity: expectedIdentity, port: 49374, ipv6: true }])
      )
      expect(service.isActivated).toBe(true)
      expect(service.isRunning()).toBe(true)
    }
  )

  it('keeps the gateway running when asynchronous key-store availability rejects', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.enabled', true)
    await expectPendingIdentity(() => service._doInit())
    rejectAvailability(new Error('Keychain denied'))
    await vi.waitFor(() =>
      expect(application.get('CacheService').getShared('feature.remote_access.discovery_status')).toBe('unavailable')
    )
    expect(transport.published).toEqual([])
    expect(service.isActivated).toBe(true)
    expect(service.isRunning()).toBe(true)
  })

  it('does not publish a late identity after ingress closes', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.enabled', true)
    await expectPendingIdentity(() => service._doInit())
    remote.closeIngress()
    resolveAvailability(true)
    expect((await withinBudget(() => remote.createInvitation())).desktopIdentity).toBe(expectedIdentity)
    expect(transport.published).toEqual([])
    expect(application.get('CacheService').getShared('feature.remote_access.discovery_status')).toBe('inactive')
  })

  it('does not activate listeners or touch the key store on disabled startup with a saved LAN host', async () => {
    await withinBudget(() => service._doInit())
    expect(service.isActivated).toBe(false)
    expect(service.isRunning()).toBe(false)
    expect(transport.start).toHaveBeenCalledTimes(0)
    expect(storage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(0)
    expect(storage.encryptStringAsync).toHaveBeenCalledTimes(0)
    expect(storage.decryptStringAsync).toHaveBeenCalledTimes(0)
    expect(storage.getSelectedStorageBackend).toHaveBeenCalledTimes(0)
    expect(transport.published).toEqual([])
  })
})
