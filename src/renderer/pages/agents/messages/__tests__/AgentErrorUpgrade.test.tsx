import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { OutputFor } from '@shared/ipc/types'

import { AgentErrorUpgrade } from '../AgentErrorUpgrade'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))

const agent: AgentEntity = {
  id: 'codex',
  type: 'local',
  name: 'Codex',
  model: null,
  modelName: null,
  orderKey: 'a',
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
  configuration: { localRuntime: { protocol: 'codex', presetId: 'codex', enabled: true, args: [], env: {} } }
}
let canUpgrade = true
let finishInstall: (result: OutputFor<'ai.local_agents.install'>) => void

beforeEach(() => {
  MockCacheUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/agents/:agentId', agent)
  canUpgrade = true
  vi.mocked(ipcApi.request)
    .mockReset()
    .mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect')
        return [{ presetId: 'codex', source: 'system', path: '/bin/codex' }] as never
      if (route === 'ai.local_agents.version') return { current: '1.0.0', latest: '2.0.0', canUpgrade } as never
      if (route === 'ai.local_agents.install')
        return new Promise((resolve) => {
          finishInstall = resolve
        }) as never
      throw new Error(`Unexpected route: ${route}`)
    })
})

it('upgrades the offered version, prevents repeat clicks and shows completion without sending a message', async () => {
  const user = userEvent.setup()
  render(<AgentErrorUpgrade agentId="codex" />)
  await user.click(await screen.findByRole('button', { name: 'Codex CLI · 升级至 2.0.0' }))
  expect(screen.getByRole('button', { name: 'Codex CLI · 正在升级至 2.0.0…' })).toBeDisabled()
  expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.install', { presetId: 'codex', targetVersion: '2.0.0' })
  await act(async () => finishInstall({ ok: true, path: '/bin/codex', reused: false }))
  expect(screen.getByRole('status')).toHaveTextContent('升级成功')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('keeps the upgrade available after a failed install and displays its reason', async () => {
  const user = userEvent.setup()
  render(<AgentErrorUpgrade agentId="codex" />)
  await user.click(await screen.findByRole('button', { name: 'Codex CLI · 升级至 2.0.0' }))
  await act(async () => finishInstall({ ok: false, reason: 'failed', detail: 'Registry unavailable' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Registry unavailable')
  expect(screen.getByRole('button', { name: 'Codex CLI · 升级至 2.0.0' })).toBeEnabled()
})

it('does not offer an upgrade when the installed version is current', async () => {
  canUpgrade = false
  render(<AgentErrorUpgrade agentId="codex" />)
  await waitFor(() =>
    expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.version', { presetId: 'codex', latest: true })
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('does not offer to upgrade the default install when the agent uses an executable override', async () => {
  MockUseDataApiUtils.mockQueryData('/agents/:agentId', {
    ...agent,
    configuration: { localRuntime: { ...agent.configuration!.localRuntime!, executableOverride: '/custom/codex' } }
  })
  render(<AgentErrorUpgrade agentId="codex" />)
  await act(async () => {})
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(ipcApi.request).not.toHaveBeenCalled()
})
