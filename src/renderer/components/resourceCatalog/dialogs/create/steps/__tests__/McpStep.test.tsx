import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { mockPreferenceService, mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@renderer/data/DataApiService'
import i18n from '@renderer/i18n/resolver'
import { buildCreateAssistantDto } from '@renderer/utils/resourceCatalog/resourceCreate'
import type { McpServer } from '@shared/data/types/mcpServer'

import type { ResourceCreateWizardFormValues } from '../../types'
import { McpStep } from '../McpStep'

vi.unmock('@cherrystudio/ui')

const key = 'assistant.default_mcp_server_ids'
const servers = [
  { id: 'a', name: 'Files', type: 'stdio', isActive: true },
  { id: 'b', name: 'Research', type: 'stdio', isActive: true },
  { id: 'inactive', name: 'Inactive server', type: 'stdio', isActive: false },
  { id: 'browser', name: '@cherry/browser', type: 'inMemory', isActive: true }
] as McpServer[]

function Editor() {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      name: 'Assistant',
      avatar: '💬',
      agentType: 'claude-code',
      permissionMode: 'auto',
      modelId: 'provider::model',
      description: '',
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: []
    }
  })
  const reviewed = form.watch('reviewedMcpServerIds')
  return (
    <form
      onSubmit={form.handleSubmit((values) =>
        dataApiService.post('/assistants', {
          body: buildCreateAssistantDto({ ...values, modelId: 'provider::model' })
        })
      )}>
      <McpStep form={form} active disabled={false} portalContainer={null} />
      <button type="submit" disabled={reviewed === undefined}>
        Save assistant
      </button>
    </form>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  mockPreferenceService._resetMockState()
  mockPreferenceState.set(key, ['a', 'inactive', 'removed', 'browser'])
  MockDataApiUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  const response = { items: servers, total: servers.length, page: 1 }
  MockDataApiUtils.setCustomResponse('/mcp-servers', 'GET', response)
  MockUseDataApiUtils.mockQueryData('/mcp-servers', response)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('McpStep reviewed selection', () => {
  it('refreshes availability after a hidden tab returns without replacing reviewed IDs', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Activity mode="visible">
        <Editor />
      </Activity>
    )
    await user.click(await screen.findByRole('switch', { name: 'Files' }))
    rerender(
      <Activity mode="hidden">
        <Editor />
      </Activity>
    )
    const updated = { items: servers.map((server) => ({ ...server, isActive: true })), total: servers.length, page: 1 }
    MockDataApiUtils.setCustomResponse('/mcp-servers', 'GET', updated)
    MockUseDataApiUtils.mockQueryData('/mcp-servers', updated)
    mockPreferenceState.set(key, ['b'])
    rerender(
      <Activity mode="visible">
        <Editor />
      </Activity>
    )
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Inactive server' })).toBeEnabled())
    expect(screen.getByRole('switch', { name: 'Files' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Research' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save assistant' }))
    expect(dataApiService.post).toHaveBeenLastCalledWith('/assistants', {
      body: expect.objectContaining({ reviewedMcpServerIds: [] })
    })
  })
  it('shows active inherited servers, freezes the reviewed set, and preserves clearing without changing defaults', async () => {
    const user = userEvent.setup()
    render(<Editor />)
    const files = await screen.findByRole('switch', { name: 'Files' })
    expect(files).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Research' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Inactive server' })).not.toBeChecked()
    expect(screen.queryByRole('switch', { name: '@cherry/browser' })).not.toBeInTheDocument()

    await act(async () => mockPreferenceService.set(key, ['b']))
    await user.click(screen.getByRole('button', { name: 'Save assistant' }))
    expect(dataApiService.post).toHaveBeenLastCalledWith('/assistants', {
      body: expect.objectContaining({ reviewedMcpServerIds: ['a'] })
    })
    await user.click(files)
    await user.click(screen.getByRole('button', { name: 'Save assistant' }))
    expect(dataApiService.post).toHaveBeenLastCalledWith('/assistants', {
      body: expect.objectContaining({ reviewedMcpServerIds: [] })
    })
    expect(mockPreferenceState.get(key)).toEqual(['b'])
  })

  it('displays and clears the seed catalog even when the independent picker query has no rows', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.resetMocks()
    render(<Editor />)
    const files = await screen.findByRole('switch', { name: 'Files' })
    expect(files).toBeChecked()
    await user.click(files)
    await user.click(screen.getByRole('button', { name: 'Save assistant' }))
    expect(dataApiService.post).toHaveBeenLastCalledWith('/assistants', {
      body: expect.objectContaining({ reviewedMcpServerIds: [] })
    })
  })

  it('keeps an unavailable preference unresolved and lets retry recover', async () => {
    const user = userEvent.setup()
    mockPreferenceService.getAuthoritative.mockResolvedValueOnce(undefined)
    render(<Editor />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load MCP defaults")
    expect(screen.getByRole('button', { name: 'Save assistant' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('switch', { name: 'Files' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save assistant' })).toBeEnabled()
  })

  it('does not let an earlier closed editor overwrite a new selection when its read finishes late', async () => {
    let resolve!: (ids: string[]) => void
    mockPreferenceService.getAuthoritative.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const first = render(<Editor />)
    expect(screen.getByRole('button', { name: 'Save assistant' })).toBeDisabled()
    first.unmount()
    mockPreferenceState.set(key, ['b'])
    render(<Editor />)
    expect(await screen.findByRole('switch', { name: 'Research' })).toBeChecked()
    await act(async () => resolve(['a']))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Files' })).not.toBeChecked())
    expect(screen.getByRole('switch', { name: 'Research' })).toBeChecked()
  })
})
