import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import type { AgentEntity } from '@shared/data/types/agent'
import { createUniqueModelId } from '@shared/data/types/model'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { useLocalAgentModelSelection } from '../useLocalAgentModelSelection'

const gatewayState = vi.hoisted(() => ({ start: vi.fn<() => Promise<boolean>>() }))
vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: { host: '127.0.0.1', port: 23333, apiKey: null },
    apiGatewayRunning: false,
    startApiGateway: gatewayState.start
  })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const provider = {
  id: 'custom',
  name: 'Custom Provider',
  isEnabled: true,
  authType: 'api-key',
  endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://example.test' } }
}
const model = {
  id: createUniqueModelId('custom', 'claude-test'),
  name: 'Claude Test',
  capabilities: [],
  providerId: 'custom',
  endpointTypes: ['anthropic-messages']
}
const agent: AgentEntity = {
  createdAt: '',
  updatedAt: '',
  orderKey: 'a0',
  model: null,
  modelName: null,
  id: 'agent',
  type: 'local',
  name: 'Pi',
  configuration: { localRuntime: { presetId: 'pi-acp', protocol: 'acp', enabled: true, args: [], env: {} } }
}
let disk: Map<CliConfigTarget, string>

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.stubGlobal('__APP_EDITION__', 'global')
  gatewayState.start.mockResolvedValue(true)
  vi.stubGlobal('api', { preference: { get: vi.fn().mockResolvedValue('gateway-secret') } })
  disk = new Map([['pi-settings', '{"theme":"dark"}']])
  MockUseDataApiUtils.mockQueryData('/providers', [provider] as never)
  const query = mockUseQuery.getMockImplementation()!
  mockUseQuery.mockImplementation((path, options) =>
    path === '/models' ? { ...query(path, options), data: [model] } : query(path, options)
  )
  vi.mocked(dataApiService.get).mockImplementation(async (path) => {
    if (path === '/providers/custom') return provider as never
    if (path === '/providers/custom/api-keys')
      return { keys: [{ id: 'key', key: 'test-secret', isEnabled: true }] } as never
    if (path === `/models/${model.id}`) return model as never
    return undefined as never
  })
  vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
    if (route === 'code_cli.read_config') {
      const { targets } = input as { targets: CliConfigTarget[] }
      return {
        files: targets.map((target) => ({ target, path: `/test/${target}`, content: disk.get(target) ?? null }))
      } as never
    }
    if (route === 'ai.local_agents.select_model') {
      const selection = input as {
        files?: { target: CliConfigTarget; content: string }[]
        nativeModel?: string
        sourceModelId?: string
        sourceModelViaGateway?: boolean
      }
      for (const file of selection.files ?? []) disk.set(file.target, file.content)
      return {
        ...agent,
        configuration: {
          localRuntime: {
            ...agent.configuration!.localRuntime,
            nativeModel: selection.nativeModel,
            sourceModelId: selection.sourceModelId,
            sourceModelViaGateway: selection.sourceModelViaGateway
          }
        }
      } as never
    }
    throw new Error(`Unexpected route ${route}`)
  })
})

it('offers compatible Cherry models in the native list and clears their credentials when returning to native', async () => {
  const { result } = renderHook(() =>
    useLocalAgentModelSelection(agent.configuration!.localRuntime, [{ id: 'anthropic/native', name: 'Native' }])
  )
  expect(result.current.models.map((entry) => entry.name)).toEqual(['Native', 'Claude Test', 'Claude Test'])
  const selected = await result.current.select(agent, `cherry-model:${model.id}`)
  expect(selected?.configuration?.localRuntime?.sourceModelId).toBe(model.id)
  const providers = JSON.parse(disk.get('pi-models')!).providers
  expect(Object.values(providers)).toEqual([
    expect.objectContaining({ apiKey: 'test-secret', baseUrl: 'https://example.test' })
  ])
  expect(JSON.parse(disk.get('pi-settings')!)).toMatchObject({ theme: 'dark', defaultModel: 'claude-test' })
  await result.current.select(selected!, 'anthropic/native')
  expect(JSON.parse(disk.get('pi-models')!).providers).toEqual({})
  expect(JSON.parse(disk.get('pi-settings')!)).toEqual({ theme: 'dark' })
})

it('leaves existing files intact if the selected provider has no usable credential', async () => {
  const get = vi.mocked(dataApiService.get).getMockImplementation()!
  vi.mocked(dataApiService.get).mockImplementation(async (path, ...args) =>
    path === '/providers/custom/api-keys' ? ({ keys: [] } as never) : get(path, ...args)
  )
  const { result } = renderHook(() => useLocalAgentModelSelection(agent.configuration!.localRuntime, []))
  await expect(result.current.select(agent, `cherry-model:${model.id}`)).rejects.toThrow('missing required')
  expect([...disk]).toEqual([['pi-settings', '{"theme":"dark"}']])
})

it('writes only gateway credentials and preserves the selected transport after reopening', async () => {
  const { result, rerender } = renderHook((config) => useLocalAgentModelSelection(config, []), {
    initialProps: agent.configuration!.localRuntime
  })
  const selected = await result.current.select(agent, `gateway-model:${model.id}`)
  expect(selected?.configuration?.localRuntime?.sourceModelViaGateway).toBe(true)
  const written = disk.get('pi-models')!
  expect(written).toContain('gateway-secret')
  expect(written).not.toContain('test-secret')
  expect(Object.values(JSON.parse(written).providers)).toEqual([
    expect.objectContaining({ baseUrl: 'http://127.0.0.1:23333' })
  ])
  rerender(selected!.configuration!.localRuntime)
  expect(result.current.value).toBe(`gateway-model:${model.id}`)
  const restored = await result.current.select(selected!, 'anthropic/native')
  expect(restored?.configuration?.localRuntime?.sourceModelViaGateway).toBeUndefined()
  expect(JSON.parse(disk.get('pi-models')!).providers).toEqual({})
})

it('does not change CLI files when the gateway cannot start', async () => {
  gatewayState.start.mockResolvedValue(false)
  const { result } = renderHook(() => useLocalAgentModelSelection(agent.configuration!.localRuntime, []))
  await expect(result.current.select(agent, `gateway-model:${model.id}`)).rejects.toThrow('API gateway failed to start')
  expect([...disk]).toEqual([['pi-settings', '{"theme":"dark"}']])
})
