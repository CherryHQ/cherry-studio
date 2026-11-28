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
  capabilities: ['reasoning', 'function-call'],
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
  localRuntime: { providerId: 'pi-provider', presetId: 'pi-acp', enabled: true, args: [], env: {} }
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
        nativeModel?: string
        sourceModelId?: string
        sourceModelViaGateway?: boolean
      }
      return {
        ...agent,
        localRuntime: {
          ...agent.localRuntime,
          nativeModel: selection.nativeModel,
          sourceModelId: selection.sourceModelId,
          sourceModelViaGateway: selection.sourceModelViaGateway
        }
      } as never
    }
    throw new Error(`Unexpected route ${route}`)
  })
})

it('offers only native models and Cherry models through the gateway', () => {
  const { result } = renderHook(() =>
    useLocalAgentModelSelection(agent.localRuntime, [
      {
        id: 'anthropic/native',
        name: 'Native',
        registryModel: { id: 'registry-id', capabilities: ['function-call'], inputModalities: ['text', 'image'] }
      }
    ])
  )
  expect(result.current.models.find((option) => option.id === 'anthropic/native')?.tags).toEqual([
    'image-recognition',
    'function-call'
  ])
  const gatewayOption = result.current.models.find((option) => option.source === 'gateway')
  expect(gatewayOption?.group).toBe('Custom Provider')
  expect(gatewayOption?.tags).toEqual(['reasoning', 'function-call'])
  expect(result.current.models.map(({ id, source }) => ({ id, source }))).toEqual([
    { id: 'anthropic/native', source: 'native' },
    { id: `gateway-model:${model.id}`, source: 'gateway' }
  ])
})

it.each([
  ['antigravity-acp', 'gemini'],
  ['cursor', 'composer']
] as const)('selects advertised %s models while keeping gateway models unavailable', async (presetId, id) => {
  const config = { ...agent.localRuntime!, presetId }
  const { result } = renderHook(() => useLocalAgentModelSelection(config, [{ id, name: id }]))
  expect(result.current.sourceRestrictions?.native).toBeUndefined()
  expect(result.current.sourceRestrictions?.gateway).toBeTruthy()
  const selected = await result.current.select(agent, id)
  expect(selected?.localRuntime?.nativeModel).toBe(id)
  await expect(result.current.select(agent, 'gateway-model:missing')).rejects.toThrow()
})

it('rejects stale direct-provider selections without changing CLI files', async () => {
  const { result } = renderHook(() => useLocalAgentModelSelection(agent.localRuntime, []))
  await expect(result.current.select(agent, `cherry-model:${model.id}`)).rejects.toThrow()
  expect([...disk]).toEqual([['pi-settings', '{"theme":"dark"}']])
})

it('saves and clears a launch-only gateway model without writing shared CLI files', async () => {
  const config = { ...agent.localRuntime!, presetId: 'deepagents' }
  const { result, rerender } = renderHook((current) => useLocalAgentModelSelection(current, []), {
    initialProps: config
  })
  const gatewayModel = result.current.models.find((entry) => entry.source === 'gateway')!
  const selected = await result.current.select({ ...agent, localRuntime: config }, gatewayModel.id)
  expect(selected?.localRuntime).toMatchObject({ sourceModelId: model.id, sourceModelViaGateway: true })
  rerender({ ...config, sourceModelId: model.id, sourceModelViaGateway: true })
  expect(result.current.value).toBe(gatewayModel.id)
  const cleared = await result.current.select(selected!)
  expect(cleared?.localRuntime?.sourceModelId).toBeUndefined()
  expect([...disk]).toEqual([['pi-settings', '{"theme":"dark"}']])
})

it('binds a Cherry model on the Agent alone, without starting the gateway or touching CLI files', async () => {
  const native = [{ id: 'anthropic/native', name: 'Native' }]
  const { result, rerender } = renderHook((config) => useLocalAgentModelSelection(config, native), {
    initialProps: agent.localRuntime
  })
  const selected = await result.current.select(agent, `gateway-model:${model.id}`)
  expect(selected?.localRuntime).toMatchObject({ sourceModelId: model.id, sourceModelViaGateway: true })
  expect(gatewayState.start).not.toHaveBeenCalled()
  expect([...disk]).toEqual([['pi-settings', '{"theme":"dark"}']])
  rerender(selected!.localRuntime)
  expect(result.current.value).toBe(`gateway-model:${model.id}`)
  const restored = await result.current.select(selected!, 'anthropic/native')
  expect(restored?.localRuntime).toMatchObject({ nativeModel: 'anthropic/native' })
  expect(restored?.localRuntime?.sourceModelId).toBeUndefined()
})

it('offers no Cherry models to an agent Cherry cannot bind at launch', async () => {
  const config = { ...agent.localRuntime!, presetId: 'factory-droid' }
  const { result } = renderHook(() => useLocalAgentModelSelection(config, [{ id: 'native', name: 'native' }]))
  expect(result.current.models.some((option) => option.source === 'gateway')).toBe(false)
  await expect(result.current.select(agent, `gateway-model:${model.id}`)).rejects.toThrow()
})
