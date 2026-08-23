import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationIslandApp from '../ConversationIslandApp'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  shouldThrow: false
}))

vi.mock('../ConversationIsland', () => ({
  default: () => {
    if (mocks.shouldThrow) throw new Error('conversation island boom')
    return <div>Conversation Island content</div>
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.ipcRequest(...args) },
  useIpcOn: vi.fn()
}))

describe('ConversationIslandApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.shouldThrow = false
    mocks.ipcRequest.mockResolvedValue(undefined)
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.language': 'en-US',
      'ui.custom_css': ':root { --conversation-island-test: ready; }',
      'ui.theme_mode': ThemeMode.dark,
      'ui.theme_user.color_primary': '#00b96b',
      'ui.theme_user.font_family': '',
      'ui.theme_user.code_font_family': ''
    })
    document.documentElement.classList.remove('light', 'dark')
    document.body.classList.remove('light', 'dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('user-defined-custom-css')?.remove()
    document.documentElement.classList.remove('light', 'dark')
    document.body.classList.remove('light', 'dark')
  })

  it('applies saved window theme and custom CSS to the rendered island', async () => {
    render(<ConversationIslandApp />)

    expect(screen.getByText('Conversation Island content')).toBeVisible()
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    expect(document.getElementById('user-defined-custom-css')).toHaveTextContent(
      ':root { --conversation-island-test: ready; }'
    )
  })

  it('closes the transparent window when its content fatally fails to render', async () => {
    mocks.shouldThrow = true

    render(<ConversationIslandApp />)

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('window.close'))
  })
})
