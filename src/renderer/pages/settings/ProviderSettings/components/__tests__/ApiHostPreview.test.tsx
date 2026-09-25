import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import ApiHost from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiHost'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

vi.mock('../../ConnectionSettings/ProviderCustomHeaderDrawer', () => ({ default: () => null }))

const defaultQuery = mockUseQuery.getMockImplementation()!
const defaultMutation = mockUseMutation.getMockImplementation()!
const persistProvider = vi.fn().mockResolvedValue(undefined)
const endpointConfigs = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://opencode.ai/zen/go/v1' },
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example.com/v1', headers: { 'x-custom': 'keep' } }
}

beforeEach(async () => {
  await i18n.changeLanguage('en-us')
  persistProvider.mockClear()
  mockUseQuery.mockImplementation((path, options) => {
    const result = defaultQuery(path, options)
    if (path !== '/providers/:providerId') return result
    return {
      ...result,
      data: {
        id: 'opencode',
        name: 'OpenCode Go',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs
      }
    }
  })
  mockUseMutation.mockImplementation((method, path, options) => {
    const result = defaultMutation(method, path, options)
    return method === 'PATCH' && path === '/providers/:providerId' ? { ...result, trigger: persistProvider } : result
  })
})

it('edits and previews the Anthropic primary host through the shared field without overwriting other endpoint settings', async () => {
  const user = userEvent.setup()
  render(<ApiHost providerId="opencode" />)

  expect(screen.getByText('Preview: https://anthropic.example.com/v1/messages')).toBeVisible()

  const input = screen.getByRole('textbox', { name: 'API Host' })
  await user.clear(input)
  await user.type(input, 'https://proxy.example.com/v1')

  expect(screen.getByText('Preview: https://proxy.example.com/v1/messages')).toBeVisible()
  expect(screen.queryByText('Preview: https://anthropic.example.com/v1/messages')).not.toBeInTheDocument()
  await user.tab()

  await waitFor(() => {
    expect(persistProvider).toHaveBeenLastCalledWith({
      params: { providerId: 'opencode' },
      body: {
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://opencode.ai/zen/go/v1' },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://proxy.example.com/v1',
            headers: { 'x-custom': 'keep' }
          }
        }
      }
    })
  })
})

it('restores an empty Anthropic primary host on blur without deleting its endpoint', async () => {
  const user = userEvent.setup()
  render(<ApiHost providerId="opencode" />)

  const input = screen.getByRole('textbox', { name: 'API Host' })
  await user.clear(input)
  await user.tab()

  expect(input).toHaveValue('https://anthropic.example.com/v1')
  expect(screen.getByText('Preview: https://anthropic.example.com/v1/messages')).toBeVisible()
  expect(persistProvider).not.toHaveBeenCalled()
})
