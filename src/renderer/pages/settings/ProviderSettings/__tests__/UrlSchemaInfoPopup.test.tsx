import { mockUseQuery, MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PopupHost from '@renderer/components/PopupHost/PopupHost'
import i18n from '@renderer/i18n/resolver'
import { ProviderSchema } from '@shared/data/types/provider'

import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'

vi.unmock('@cherrystudio/ui')
vi.unmock('@renderer/services/popup')

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

  it('allows a name-only update without adding a duplicate API key', async () => {
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
          endpointConfigs: { 'openai-chat-completions': { baseUrl: params.baseUrl } },
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
    const { result } = await showImport()
    expect(screen.getByRole('button', { name: i18n.t('common.confirm') })).toBeDisabled()
    const input = screen.getByRole('textbox', { name: i18n.t('settings.models.provider_name') })
    expect(input).toHaveValue('Saved Relay')
    await user.clear(input)
    await user.type(input, 'Renamed Relay')
    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    await expect(result).resolves.toMatchObject({
      isNew: false,
      updatedProvider: { name: 'Renamed Relay', apiKey: '' }
    })
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
