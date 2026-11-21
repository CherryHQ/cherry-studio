import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../../types'
import { NavigateToolInline } from '../NavigateTool'

function renderNavigation(input: unknown) {
  const navigateToRoute = vi.fn()
  const value: MessageListProviderValue = {
    state: {
      topic: {
        id: '0f8e7521-a342-4a63-9e3c-8801d29f6d10',
        name: 'Navigation',
        assistantId: 'assistant-1',
        messages: [],
        isNameManuallyEdited: false,
        orderKey: 'a0',
        lastActivityAt: '2026-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      },
      messages: [],
      partsByMessageId: {},
      messageNavigation: 'none',
      estimateSize: 400,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig
    },
    actions: { navigateToRoute },
    meta: { selectionLayer: false }
  }
  render(
    <MessageListProvider value={value}>
      <NavigateToolInline input={input} />
    </MessageListProvider>
  )
  return navigateToRoute
}

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
})
afterEach(cleanup)

it.each([42, { value: '/settings/provider' }])(
  'disables a malformed streamed path %j without crashing',
  async (path) => {
    const user = userEvent.setup()
    const navigateToRoute = renderNavigation({ path })
    const button = screen.getByRole('button')

    expect(button).toBeDisabled()
    await user.click(button)
    expect(navigateToRoute).not.toHaveBeenCalled()
  }
)

it('forwards only string query values and preserves literal reserved keys', async () => {
  const user = userEvent.setup()
  const query = Object.freeze(JSON.parse('{"id":"provider-1","invalid":42,"__proto__":"literal"}'))
  const navigateToRoute = renderNavigation({ path: '/settings/provider', query })

  await user.click(screen.getByRole('button', { name: '🔑 Model Provider' }))

  expect(navigateToRoute).toHaveBeenCalledWith({
    path: '/settings/provider',
    query: JSON.parse('{"id":"provider-1","__proto__":"literal"}')
  })
})
