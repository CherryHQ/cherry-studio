import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CherryConnectionTools, CONNECTION_INSTALL_TOOL_NAME } from '@main/ai/mcp/servers/cherryConnectionTools'
import { BaseService } from '@main/core/lifecycle'
import { apiGatewayHandlers } from '@main/ipc/handlers/apiGateway'
import type { OutputFor } from '@shared/ipc/types'

import { DeviceConnectionSetupService } from '../DeviceConnectionSetupService'

type Networks = OutputFor<'api_gateway.remote.check_networks'>
const state = vi.hoisted(() => ({
  check: vi.fn<(signal: AbortSignal) => Promise<Networks>>(),
  install: vi.fn<(recipe: string, signal: AbortSignal) => Promise<void>>(),
  service: undefined as DeviceConnectionSetupService | undefined
}))
vi.mock('../vpnStatus', () => ({ checkVpnNetworks: state.check }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    BinaryManager: { installSystemPackage: state.install },
    DeviceConnectionSetupService: {
      checkNetworks: () => state.service!.checkNetworks(),
      installTailscale: () => state.service!.installTailscale()
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

let service: DeviceConnectionSetupService
const absent: Networks = [{ product: 'tailscale', state: 'not-detected', networks: [] }]
const ready: Networks = [
  { product: 'tailscale', state: 'ready', networks: [{ name: 'Tailscale', hosts: ['100.64.0.2'] }] }
]

beforeEach(async () => {
  BaseService.resetInstances()
  state.check.mockReset().mockResolvedValue(absent)
  state.install.mockReset().mockResolvedValue()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
  service = new DeviceConnectionSetupService()
  state.service = service
  await service._doInit()
})

afterEach(async () => {
  await service._doStop()
  vi.restoreAllMocks()
  BaseService.resetInstances()
})

describe('device connection setup tasks', () => {
  it('shares concurrent checks and refreshes the network state on the next request', async () => {
    const pending = Promise.withResolvers<Networks>()
    state.check.mockReturnValueOnce(pending.promise)
    const first = apiGatewayHandlers['api_gateway.remote.check_networks'](undefined, { senderId: null })
    const second = service.checkNetworks()
    expect(state.check).toHaveBeenCalledTimes(1)
    pending.resolve(absent)
    await expect(Promise.all([first, second])).resolves.toEqual([absent, absent])
    state.check.mockResolvedValue(ready)
    await expect(service.checkNetworks()).resolves.toEqual(ready)
  })

  it('runs one installer when the settings page and Agent request installation together', async () => {
    const pending = Promise.withResolvers<void>()
    state.install.mockReturnValue(pending.promise)
    const page = apiGatewayHandlers['api_gateway.remote.install_tailscale'](undefined, { senderId: null })
    const agent = new CherryConnectionTools().call(CONNECTION_INSTALL_TOOL_NAME, {})
    await vi.waitFor(() => expect(state.install).toHaveBeenCalledTimes(1))
    pending.resolve()
    await expect(page).resolves.toEqual({ outcome: 'installed' })
    const result = await agent
    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          outcome: 'installed',
          downloadUrl: 'https://tailscale.com/download',
          phoneVerified: false
        })
      }
    ])
    expect(state.install).toHaveBeenCalledTimes(1)
  })

  it('preserves an existing client without installing it again', async () => {
    state.check.mockResolvedValue(ready)
    await expect(service.installTailscale()).resolves.toEqual({ outcome: 'existing' })
    expect(state.install).not.toHaveBeenCalled()
  })

  it.each([
    ['win32', 'x64'],
    ['darwin', 'x64'],
    ['linux', 'arm64']
  ] as const)('offers manual installation on %s/%s', async (platform, arch) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    vi.spyOn(process, 'arch', 'get').mockReturnValue(arch)
    await expect(service.installTailscale()).resolves.toEqual({ outcome: 'manual-required' })
    expect(state.install).not.toHaveBeenCalled()
  })

  it('allows retry after a failed check or installer', async () => {
    state.check.mockRejectedValueOnce(new Error('Check failed'))
    await expect(service.installTailscale()).rejects.toThrow('Check failed')
    state.install.mockRejectedValueOnce(new Error('Installer failed'))
    await expect(service.installTailscale()).resolves.toEqual({ outcome: 'manual-required' })
    await expect(service.installTailscale()).resolves.toEqual({ outcome: 'installed' })
  })

  it.each(['check', 'install'] as const)('aborts and drains an active %s before stopping', async (task) => {
    const started = Promise.withResolvers<AbortSignal>()
    const cleanup = Promise.withResolvers<void>()
    const run = async (signal: AbortSignal) => {
      started.resolve(signal)
      await cleanup.promise
      signal.throwIfAborted()
    }
    if (task === 'check')
      state.check.mockImplementation(async (signal) => {
        await run(signal)
        return absent
      })
    else state.install.mockImplementation((_recipe, signal) => run(signal))
    const result = Promise.allSettled([task === 'check' ? service.checkNetworks() : service.installTailscale()])
    const signal = await started.promise
    let stopped = false
    const stop = service._doStop().then(() => {
      stopped = true
    })
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(() => service.checkNetworks()).toThrow()
    expect(() => service.installTailscale()).toThrow()
    cleanup.resolve()
    await stop
    expect(await result).toEqual([{ status: 'rejected', reason: signal.reason }])
  })
})
