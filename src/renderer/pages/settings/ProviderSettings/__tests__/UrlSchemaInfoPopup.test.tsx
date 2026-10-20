import { mockUseMutation, mockUseQuery, MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PopupHost from '@renderer/components/PopupHost/PopupHost'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { ProviderSchema } from '@shared/data/types/provider'

import { useProviderDeepLinkImport } from '../hooks/useProviderDeepLinkImport'
import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'

vi.unmock('@cherrystudio/ui')
vi.unmock('@renderer/services/popup')
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))

const params = { id: 'my-relay', name: 'Relay', apiKey: 'test-key', baseUrl: 'https://example.com/v1' }

async function showImport(importParams = params) {
  render(<PopupHost />)
  let result!: ReturnType<typeof UrlSchemaInfoPopup.show>
  act(() => {
    result = UrlSchemaInfoPopup.show(importParams)
  })
  await screen.findByRole('dialog')
  return { result }
}

describe('provider import names', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    MockUseDataApiUtils.mockQueryResult('/providers', { data: [] })
  })

  afterEach(() => {
    act(() => UrlSchemaInfoPopup.hide())
  })

  it.each(
    [
      { ...params, name: 123 },
      { ...params, name: null },
      { ...params, name: {} },
      { ...params, id: 123, name: undefined },
      { ...params, id: {}, name: '' },
      { ...params, apiKey: 123 },
      { ...params, baseUrl: 123 },
      { ...params, type: 123 },
      { ...params, type: 'unsupported' },
      null,
      []
    ].map((payload) => ({ payload }))
  )('rejects malformed import data before rendering a popup: $payload', async ({ payload }) => {
    const onSelectProvider = vi.fn()
    render(
      <>
        <p>Provider settings</p>
        <PopupHost />
      </>
    )
    renderHook(() => useProviderDeepLinkImport(JSON.stringify(payload), onSelectProvider))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(i18n.t('settings.models.provider_key_add_failed_by_invalid_data'))
    )
    expect(screen.getByText('Provider settings')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider' })
    expect(onSelectProvider).not.toHaveBeenCalled()
  })

  it.each([undefined, ''])('uses the string ID when the imported name is %j', async (name) => {
    const user = userEvent.setup()
    const onSelectProvider = vi.fn()
    render(<PopupHost />)
    renderHook(() => useProviderDeepLinkImport(JSON.stringify({ ...params, name }), onSelectProvider))

    expect(await screen.findByRole('textbox', { name: i18n.t('settings.models.provider_name') })).toHaveValue(params.id)
    await user.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider' }))
    expect(onSelectProvider).not.toHaveBeenCalled()
  })

  it('returns the edited, trimmed name when confirming a new provider', async () => {
    const user = userEvent.setup()
    const { result } = await showImport()
    const input = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_name') })
    expect(input).toHaveValue('Relay')
    await user.clear(input)
    await user.type(input, '  Work Relay  ')
    await user.click(screen.getByRole('button', { name: i18n.t('common.add') }))
    await expect(result).resolves.toMatchObject({
      isNew: true,
      displayName: 'Work Relay',
      updatedProvider: { id: params.id, name: 'Work Relay', apiKey: params.apiKey, apiHost: params.baseUrl }
    })
  })

  it('does not allow an empty name and discards edits on cancel', async () => {
    const user = userEvent.setup()
    const { result } = await showImport()
    const input = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_name') })
    await user.clear(input)
    await user.type(input, '   ')
    expect(screen.getByRole('button', { name: i18n.t('common.add') })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    await expect(result).resolves.toMatchObject({ updatedProvider: undefined })
  })

  it('imports only the edited name while preserving multiple endpoints and connection overrides', async () => {
    const user = userEvent.setup()
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const addApiKey = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/providers/:providerId', updateProvider)
    const previousMutation = mockUseMutation.getMockImplementation()!
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/providers/:providerId/api-keys', addApiKey)
    const apiKeyMutation = mockUseMutation.getMockImplementation()!
    mockUseMutation.mockImplementation((method, path, options) =>
      method === 'POST' && path === '/providers/:providerId/api-keys'
        ? apiKeyMutation(method, path, options)
        : previousMutation(method, path, options)
    )
    MockUseDataApiUtils.mockQueryResult('/providers', {
      data: [
        ProviderSchema.parse({
          id: params.id,
          name: 'Saved Relay',
          isEnabled: true,
          reportsActualCost: false,
          apiKeys: [],
          authType: 'api-key',
          settings: {},
          authConfig: { type: 'api-key', headerName: 'x-relay-key', prefix: 'Token' },
          endpointConfigs: {
            'openai-chat-completions': {
              baseUrl: params.baseUrl,
              dialect: { streamOptions: false, developerRole: true }
            },
            'anthropic-messages': { baseUrl: 'https://anthropic.example.com', dialect: { streamOptions: false } }
          },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const previousQuery = mockUseQuery.getMockImplementation()!
    mockUseQuery.mockImplementation((path, options) => {
      const result = previousQuery(path, options)
      return path === '/providers/:providerId/api-keys'
        ? { ...result, data: { keys: [{ key: params.apiKey }] } }
        : result
    })
    const onSelectProvider = vi.fn()
    render(<PopupHost />)
    renderHook(() => useProviderDeepLinkImport(JSON.stringify(params), onSelectProvider))
    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: i18n.t('common.confirm') })).toBeDisabled()
    const input = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_name') })
    expect(input).toHaveValue('Saved Relay')
    await user.clear(input)
    await user.type(input, 'Renamed Relay')
    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    await waitFor(() => expect(onSelectProvider).toHaveBeenCalledWith(params.id))
    expect(updateProvider).toHaveBeenCalledWith({
      params: { providerId: params.id },
      body: { name: 'Renamed Relay' }
    })
    expect(addApiKey).not.toHaveBeenCalled()
  })

  it('keeps the localized name of canonical presets read-only', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/providers', {
      data: [
        ProviderSchema.parse({
          id: 'openai',
          presetProviderId: 'openai',
          name: 'Internal preset name',
          isEnabled: true,
          reportsActualCost: false,
          apiKeys: [],
          authType: 'api-key',
          settings: {},
          endpointConfigs: { 'openai-chat-completions': { baseUrl: params.baseUrl } },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const { result } = await showImport({ ...params, id: 'openai' })
    const input = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_name') })
    expect(input).toHaveValue('OpenAI')
    expect(input).toHaveAttribute('readonly')
    await user.click(screen.getByRole('button', { name: i18n.t('common.add') }))
    await expect(result).resolves.toMatchObject({
      displayName: 'OpenAI',
      updatedProvider: { name: 'Internal preset name' }
    })
  })
})
