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

  it('lets the user rename the provider ID so a colliding import becomes a separate provider', async () => {
    const user = userEvent.setup()
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
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://other.example.com' } },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const { result } = await showImport()
    expect(screen.getByText(i18n.t('settings.models.provider_import_id_exists'))).toBeVisible()
    const idInput = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_id') })
    await user.clear(idInput)
    await user.type(idInput, 'my-relay-2')
    expect(screen.queryByText(i18n.t('settings.models.provider_import_id_exists'))).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: i18n.t('common.add') }))
    await expect(result).resolves.toMatchObject({
      isNew: true,
      updatedProvider: { id: 'my-relay-2', apiKey: params.apiKey, apiHost: params.baseUrl }
    })
  })

  it('rejects invalid provider IDs', async () => {
    const user = userEvent.setup()
    await showImport()
    const idInput = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_id') })
    await user.clear(idInput)
    await user.type(idInput, 'bad/id')
    expect(screen.getByText(i18n.t('settings.models.provider_import_id_invalid'))).toBeVisible()
    expect(screen.getByRole('button', { name: i18n.t('common.add') })).toBeDisabled()
  })

  it('preserves an untouched whitespace-bearing link ID instead of trimming it', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/providers', {
      data: [
        ProviderSchema.parse({
          id: ' relay ',
          name: 'Saved Relay',
          isEnabled: true,
          reportsActualCost: false,
          apiKeys: [],
          authType: 'api-key',
          settings: {},
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://other.example.com' } },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const { result } = await showImport({ ...params, id: ' relay ' })
    // the raw link ID still matches the stored provider, not a trimmed look-alike
    expect(screen.getByText(i18n.t('settings.models.provider_import_id_exists'))).toBeVisible()
    await user.click(screen.getByRole('button', { name: i18n.t('common.add') }))
    await expect(result).resolves.toMatchObject({
      isNew: false,
      nameOnly: true,
      updatedProvider: { id: ' relay ', apiHost: 'https://other.example.com' }
    })
  })

  it('trims the provider ID only once the user edits it', async () => {
    const user = userEvent.setup()
    const { result } = await showImport()
    const idInput = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_id') })
    await user.clear(idInput)
    await user.type(idInput, '  my-relay-2  ')
    await user.click(screen.getByRole('button', { name: i18n.t('common.add') }))
    await expect(result).resolves.toMatchObject({
      isNew: true,
      updatedProvider: { id: 'my-relay-2', apiKey: params.apiKey }
    })
  })

  it('never treats keys from a previously matched provider as duplicates after the ID changes', async () => {
    const user = userEvent.setup()
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
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://other.example.com' } },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const previousQuery = mockUseQuery.getMockImplementation()!
    mockUseQuery.mockImplementation((path, options) => {
      const result = previousQuery(path, options)
      return path === '/providers/:providerId/api-keys' && options?.enabled !== false
        ? { ...result, data: { keys: [{ key: params.apiKey }] } }
        : result
    })
    const { result } = await showImport()
    // the keys query must not retain data across ID edits, or the imported key would be
    // dropped as a "duplicate" of a provider it was never checked against
    await waitFor(() =>
      expect(mockUseQuery).toHaveBeenCalledWith(
        '/providers/:providerId/api-keys',
        expect.objectContaining({ swrOptions: expect.objectContaining({ keepPreviousData: false }) })
      )
    )
    // the imported key matches one stored on the matched provider, so confirming is a no-op
    expect(screen.getByRole('button', { name: i18n.t('common.confirm') })).toBeDisabled()
    const idInput = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_id') })
    await user.clear(idInput)
    await user.type(idInput, 'my-relay-2')
    // the new ID matches nothing, so the imported key must survive into the new provider
    await user.click(screen.getByRole('button', { name: i18n.t('common.add') }))
    await expect(result).resolves.toMatchObject({
      isNew: true,
      updatedProvider: { id: 'my-relay-2', apiKey: params.apiKey }
    })
  })

  it('discloses every configured endpoint host when merging a key into a multi-host provider', async () => {
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
          endpointConfigs: {
            'openai-chat-completions': { baseUrl: 'https://primary.example.com/v1' },
            'anthropic-messages': { baseUrl: 'https://anthropic.example.com' }
          },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    await showImport()
    expect(
      screen.getByText(
        i18n.t('settings.models.provider_import_key_destination_multi', {
          hosts: 'primary.example.com, anthropic.example.com'
        })
      )
    ).toBeVisible()
  })

  it('never echoes unparseable stored URLs or embedded credentials in the destination notice', async () => {
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
          endpointConfigs: {
            'openai-chat-completions': { baseUrl: 'https://user:secret@primary.example.com/v1' },
            'anthropic-messages': { baseUrl: 'not a url sk-secret-123' }
          },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    await showImport()
    // userinfo is stripped by URL parsing; the unparseable entry is counted, never echoed
    expect(
      screen.getByText(
        i18n.t('settings.models.provider_import_key_destination_unknown_hosts', {
          hosts: 'primary.example.com',
          num: 1
        })
      )
    ).toBeVisible()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
    expect(screen.queryByText(/sk-secret-123/)).not.toBeInTheDocument()
  })

  it('discloses the revived host a bare scheme is formatted into before dispatch', async () => {
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
          // unparseable on its own, but formatApiHost appends /v1 -> 'http:/v1' -> host 'v1'
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'http://' } },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    await showImport()
    expect(screen.getByText(i18n.t('settings.models.provider_import_key_destination', { host: 'v1' }))).toBeVisible()
  })

  it('discloses the host Ollama formatting actually dispatches to when it strips the stored one', async () => {
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
          // formatOllamaApiHost strips the /v1$-shaped host: 'http://v1' -> 'http:/api' -> host 'api'
          endpointConfigs: { 'ollama-chat': { baseUrl: 'http://v1' } },
          defaultChatEndpoint: 'ollama-chat'
        })
      ]
    })
    await showImport()
    expect(screen.getByText(i18n.t('settings.models.provider_import_key_destination', { host: 'api' }))).toBeVisible()
  })

  it('never claims exclusivity in any destination notice wording', () => {
    // chat and model-list transports can normalize the same stored base URL to
    // different hosts, so no wording may promise an exclusive destination
    expect(i18n.t('settings.models.provider_import_key_destination', { host: 'x' })).not.toMatch(/only/i)
    expect(i18n.t('settings.models.provider_import_key_destination_multi', { hosts: 'x' })).not.toMatch(/only/i)
    expect(i18n.t('settings.models.provider_import_key_destination_unknown_hosts', { hosts: 'x', num: 1 })).not.toMatch(
      /only/i
    )
    expect(i18n.t('settings.models.provider_import_key_destination_unknown_only', { num: 1 })).not.toMatch(/only/i)
  })

  it('counts destinations that stay unparseable instead of claiming an exclusive host', async () => {
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
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'totally not a url' } },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    await showImport()
    expect(
      screen.getByText(i18n.t('settings.models.provider_import_key_destination_unknown_only', { num: 1 }))
    ).toBeVisible()
    expect(screen.queryByText(/totally not a url/)).not.toBeInTheDocument()
    expect(screen.queryByText(/sent only to/)).not.toBeInTheDocument()
  })

  it('keeps the single-host destination notice for a new provider', async () => {
    await showImport()
    expect(
      screen.getByText(i18n.t('settings.models.provider_import_key_destination', { host: 'example.com' }))
    ).toBeVisible()
  })

  it('merges into an existing provider without overwriting its endpoint unless replace is chosen', async () => {
    const user = userEvent.setup()
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
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://other.example.com' } },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const { result } = await showImport()
    await user.click(screen.getByRole('button', { name: i18n.t('common.add') }))
    await expect(result).resolves.toMatchObject({
      isNew: false,
      nameOnly: true,
      updatedProvider: { name: 'Saved Relay', apiHost: 'https://other.example.com' }
    })

    const second = await showImport()
    await user.click(
      screen.getAllByRole('radio', { name: i18n.t('settings.models.provider_import_resolution_replace') })[0]
    )
    await user.click(screen.getAllByRole('button', { name: i18n.t('common.add') })[0])
    await expect(second.result).resolves.toMatchObject({
      isNew: false,
      nameOnly: false,
      updatedProvider: { name: 'Relay', apiHost: params.baseUrl }
    })
  })

  it('blocks confirmation while existing keys load, then allows a new key after loading completes', async () => {
    const user = userEvent.setup()
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
          endpointConfigs: {
            'openai-chat-completions': { baseUrl: 'https://saved.example.com' }
          },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    let loading = true
    const previousQuery = mockUseQuery.getMockImplementation()!
    mockUseQuery.mockImplementation((path, options) => {
      const result = previousQuery(path, options)
      return path === '/providers/:providerId/api-keys'
        ? {
            ...result,
            isLoading: loading,
            data: loading ? undefined : { keys: [] }
          }
        : result
    })
    const { result } = await showImport()
    expect(screen.getByRole('button', { name: i18n.t('common.loading') })).toBeDisabled()
    loading = false
    // A normal input update rerenders the popup with the resolved query result.
    await user.type(
      screen.getByRole('textbox', {
        name: i18n.t('settings.models.provider_name')
      }),
      ' 2'
    )
    const add = screen.getByRole('button', { name: i18n.t('common.add') })
    expect(add).toBeEnabled()
    await user.click(add)
    await expect(result).resolves.toMatchObject({
      isNew: false,
      nameOnly: true,
      updatedProvider: {
        name: 'Saved Relay 2',
        apiKey: params.apiKey,
        apiHost: 'https://saved.example.com'
      }
    })
  })

  it('renames a provider with a whitespace-padded duplicate key without returning the key again', async () => {
    const user = userEvent.setup()
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
          endpointConfigs: {
            'openai-chat-completions': { baseUrl: 'https://saved.example.com' }
          },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const previousQuery = mockUseQuery.getMockImplementation()!
    mockUseQuery.mockImplementation((path, options) => {
      const result = previousQuery(path, options)
      return path === '/providers/:providerId/api-keys'
        ? { ...result, data: { keys: [{ key: `  ${params.apiKey}  ` }] } }
        : result
    })
    const { result } = await showImport({
      ...params,
      apiKey: `  ${params.apiKey}  `
    })
    expect(screen.getByRole('button', { name: i18n.t('common.confirm') })).toBeDisabled()
    const name = screen.getByRole('textbox', {
      name: i18n.t('settings.models.provider_name')
    })
    await user.clear(name)
    await user.type(name, 'Renamed Relay')
    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    await expect(result).resolves.toMatchObject({
      isNew: false,
      nameOnly: true,
      updatedProvider: {
        name: 'Renamed Relay',
        apiKey: '',
        apiHost: 'https://saved.example.com'
      }
    })
  })

  it('updates the destination notice when switching between merge and replace', async () => {
    const user = userEvent.setup()
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
          endpointConfigs: {
            'openai-chat-completions': {
              baseUrl: 'https://primary.example.com/v1'
            },
            'anthropic-messages': { baseUrl: 'https://secondary.example.com' }
          },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    const { result } = await showImport()
    const mergeNotice = i18n.t('settings.models.provider_import_key_destination_multi', {
      hosts: 'primary.example.com, secondary.example.com'
    })
    const replaceNotice = i18n.t('settings.models.provider_import_key_destination', { host: 'example.com' })
    expect(screen.getByText(mergeNotice)).toBeVisible()
    await user.click(
      screen.getByRole('radio', {
        name: i18n.t('settings.models.provider_import_resolution_replace')
      })
    )
    expect(screen.getByText(replaceNotice)).toBeVisible()
    expect(screen.queryByText(mergeNotice)).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('radio', {
        name: i18n.t('settings.models.provider_import_resolution_merge')
      })
    )
    expect(screen.getByText(mergeNotice)).toBeVisible()
    expect(screen.queryByText(replaceNotice)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    await expect(result).resolves.toMatchObject({ updatedProvider: undefined })
  })

  it('deduplicates equal endpoint hosts while retaining distinct ports in the destination notice', async () => {
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
          endpointConfigs: {
            'openai-chat-completions': {
              baseUrl: 'https://shared.example.com/v1'
            },
            'anthropic-messages': {
              baseUrl: 'https://shared.example.com/anthropic'
            },
            'google-generate-content': {
              baseUrl: 'https://shared.example.com:8443/gemini'
            }
          },
          defaultChatEndpoint: 'openai-chat-completions'
        })
      ]
    })
    await showImport()
    expect(
      screen.getByText(
        i18n.t('settings.models.provider_import_key_destination_multi', {
          hosts: 'shared.example.com, shared.example.com:8443'
        })
      )
    ).toBeVisible()
  })
})
