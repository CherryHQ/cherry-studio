import { webcrypto } from 'node:crypto'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AgentEntity } from '@shared/data/types/agent'

import { LocalAgentModelControl } from '../LocalAgentModelControl'

vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  getProviderDisplayName: (provider: { name: string }) => provider.name
}))
vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
const { updateNativeModel } = vi.hoisted(() => ({ updateNativeModel: vi.fn() }))
vi.mock('@renderer/hooks/agent/useAgent', () => ({ useUpdateAgent: () => ({ updateNativeModel }) }))

const agent: AgentEntity = {
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  orderKey: 'a0',
  model: null,
  modelName: null,
  id: 'local-agent',
  name: 'Local',
  type: 'local',
  configuration: {
    localRuntime: { protocol: 'acp', presetId: 'opencode', enabled: true, args: [], env: {}, nativeModel: 'first' }
  }
}
const info = {
  images: false,
  resume: true,
  models: [
    { id: 'first', name: 'First' },
    { id: 'second', name: 'Second' }
  ]
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  updateNativeModel.mockReset()
  vi.mocked(ipcApi.request).mockImplementation(
    async () => ({ files: [{ target: 'opencode-config', path: '/test/opencode.json', content: null }] }) as never
  )
})

describe('local agent model persistence', () => {
  it.each([
    ['Second', 'second'],
    ['跟随 CLI', undefined]
  ] as const)('retains the selection on failure and allows retry: %s', async (label, nativeModel) => {
    const user = userEvent.setup()
    updateNativeModel.mockResolvedValueOnce(undefined).mockResolvedValueOnce(agent)
    render(<LocalAgentModelControl agent={agent} info={info} disabled={false} side="bottom" />)
    await user.click(screen.getByRole('button', { name: '选择模型' }))
    await user.click(await screen.findByText(label))
    expect(await screen.findByText(label)).toBeVisible()
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('First')
    await user.click(screen.getByText(label))
    await waitFor(() => expect(screen.queryByText(label)).not.toBeInTheDocument())
    expect(updateNativeModel).toHaveBeenLastCalledWith(
      agent.id,
      nativeModel,
      expect.objectContaining({ files: undefined })
    )
  })
})
