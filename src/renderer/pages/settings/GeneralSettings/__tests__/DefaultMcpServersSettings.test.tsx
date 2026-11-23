import { mockPreferenceService, mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { McpServer } from '@shared/data/types/mcpServer'

import { DefaultMcpServersSettings } from '../DefaultMcpServersSettings'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/usePreference')

const key = 'assistant.default_mcp_server_ids'
const servers = [
  { id: 'a', name: 'Files', isActive: true, type: 'stdio' },
  { id: 'b', name: 'Research', isActive: true, type: 'stdio' }
] as McpServer[]

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  mockPreferenceService._resetMockState()
  mockPreferenceState.set(key, ['a'])
  MockUseDataApiUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/mcp-servers', { items: servers, total: 2, page: 1, limit: 2 })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DefaultMcpServersSettings', () => {
  it('saves opt-in defaults and reflects changes from another window', async () => {
    const user = userEvent.setup()
    render(<DefaultMcpServersSettings />)
    expect(await screen.findByRole('switch', { name: 'Files' })).toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Research' }))
    await waitFor(() => expect(mockPreferenceState.get(key)).toEqual(['a', 'b']))
    await act(async () => mockPreferenceService.set(key, []))
    expect(screen.getByRole('switch', { name: 'Files' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Research' })).not.toBeChecked()
  })

  it('does not present a failed save as persisted, and allows a later successful save', async () => {
    const user = userEvent.setup()
    render(<DefaultMcpServersSettings />)
    const files = await screen.findByRole('switch', { name: 'Files' })
    mockPreferenceService.set.mockRejectedValueOnce(new Error('Disk full'))
    await user.click(files)
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    expect(files).toBeChecked()
    expect(mockPreferenceState.get(key)).toEqual(['a'])
    await user.click(files)
    await waitFor(() => expect(files).not.toBeChecked())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockPreferenceState.get(key)).toEqual([])
  })

  it('does not expose editable fallback defaults after a failed initial read', async () => {
    const user = userEvent.setup()
    mockPreferenceState.delete(key)
    render(<DefaultMcpServersSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load MCP defaults")
    expect(screen.queryByRole('switch', { name: 'Files' })).not.toBeInTheDocument()
    mockPreferenceState.set(key, ['b'])
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('switch', { name: 'Research' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Files' })).not.toBeChecked()
  })
})
