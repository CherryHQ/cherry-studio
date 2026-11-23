import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { mockPreferenceService, mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { usePresetMcpReview } from '../usePresetMcpReview'

vi.unmock('@cherrystudio/ui')
const saved = vi.fn()
function PresetFlow() {
  const { reviewMcp, reviewDialog } = usePresetMcpReview()
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const ids = await reviewMcp()
          if (ids !== null) saved(ids)
        }}>
        Add preset
      </button>
      {reviewDialog}
    </>
  )
}
beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  mockPreferenceService._resetMockState()
  mockPreferenceState.set('assistant.default_mcp_server_ids', ['files'])
  MockDataApiUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  MockDataApiUtils.setCustomResponse('/mcp-servers', 'GET', {
    items: [{ id: 'files', name: 'Local files', isActive: true, type: 'stdio' }],
    total: 1,
    page: 1
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('preset MCP review', () => {
  it('shows inherited tools and can clear them before either shortcut receives a selection', async () => {
    const user = userEvent.setup()
    render(<PresetFlow />)
    await user.click(screen.getByRole('button', { name: 'Add preset' }))
    const files = await screen.findByRole('switch', { name: 'Local files' })
    expect(files).toBeChecked()
    expect(saved).not.toHaveBeenCalled()
    await user.click(files)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith([]))
    expect(mockPreferenceState.get('assistant.default_mcp_server_ids')).toEqual(['files'])
  })
  it('does not create anything when cancelled', async () => {
    const user = userEvent.setup()
    render(<PresetFlow />)
    await user.click(screen.getByRole('button', { name: 'Add preset' }))
    await screen.findByRole('switch', { name: 'Local files' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(saved).not.toHaveBeenCalled()
  })
})
