import '@testing-library/jest-dom/vitest'

import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelServiceSetupDialog from '../ModelServiceSetupDialog'

const mocks = vi.hoisted(() => ({
  enabledModels: [] as Model[],
  openSettingsTab: vi.fn(),
  providers: [] as Provider[],
  providerEditorProps: null as Record<string, any> | null
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: mocks.providers, isLoading: false })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mocks.enabledModels, isLoading: false })
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('../hooks/useOvmsSupport', () => ({
  useOvmsSupport: () => ({ isSupported: true })
}))

vi.mock('../components/ProviderAvatar', () => ({
  ProviderAvatar: ({ provider }: { provider: Provider }) => <span aria-hidden>{provider.name}</span>
}))

vi.mock('../ProviderList/useProviderEditor', async () => {
  const React = await import('react')

  return {
    useProviderEditor: ({ onProviderCreated }: { onProviderCreated: (id: string, context: object) => void }) => {
      const [isOpen, setIsOpen] = React.useState(false)

      return {
        isOpen,
        mode: 'add',
        initialLogo: undefined,
        startAdd: () => setIsOpen(true),
        startAddFrom: vi.fn(),
        cancel: () => setIsOpen(false),
        submit: async ({ hasApiKey }: { hasApiKey: boolean }) => {
          setIsOpen(false)
          onProviderCreated('custom-provider', { kind: 'custom', hasApiKey })
        }
      }
    }
  }
})

vi.mock('../ProviderList/ProviderEditorDrawer', () => ({
  default: (props: any) => {
    mocks.providerEditorProps = props
    return props.open ? (
      <div role="dialog" aria-label="provider-editor">
        <button type="button" onClick={props.onClose}>
          cancel-editor
        </button>
        <button type="button" onClick={() => props.onSubmit({ hasApiKey: false })}>
          create-without-key
        </button>
        <button type="button" onClick={() => props.onSubmit({ hasApiKey: true })}>
          create-with-key
        </button>
      </div>
    ) : null
  }
}))

vi.mock('../ConnectionSettings/ProviderApiSetupDialog', () => ({
  default: (props: Record<string, any>) => {
    return (
      <div role="dialog" aria-label="api-setup">
        <span>{`${props.providerId}:${props.initialStep}`}</span>
        <button type="button" onClick={props.onBack}>
          back-to-providers
        </button>
        <button
          type="button"
          onClick={() => {
            props.onSetupSuccess([makeModel('custom-provider::chat', 'custom-provider')])
            props.onClose()
          }}>
          finish-api-setup
        </button>
      </div>
    )
  }
}))

vi.mock('../ProviderLoginSetupDialog', () => ({
  default: (props: Record<string, any>) => (
    <div role="dialog" aria-label="login-setup">
      <span>{`${props.provider.id}:${props.kind}`}</span>
      <button type="button" onClick={props.onBack}>
        back-from-login
      </button>
      <button type="button" onClick={() => props.onContinueToApiSetup('models')}>
        continue-to-models
      </button>
      <button
        type="button"
        onClick={() => {
          props.onSetupSuccess([makeModel(`${props.provider.id}::chat`, props.provider.id)])
          props.onClose()
        }}>
        finish-login-setup
      </button>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function makeProvider(id: string, overrides: Partial<Provider> & Pick<Provider, 'name'>): Provider {
  return {
    id,
    apiKeys: [],
    authType: 'api-key',
    isEnabled: false,
    reportsActualCost: false,
    settings: {},
    ...overrides
  } as Provider
}

function makeModel(id: UniqueModelId, providerId: string): Model {
  return {
    id,
    providerId,
    apiModelId: id.split('::')[1],
    name: id.split('::')[1],
    capabilities: [],
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true
  }
}

function renderDialog(onResolve = vi.fn()) {
  return {
    onResolve,
    ...render(<ModelServiceSetupDialog open setupContext="chat" onResolve={onResolve} />)
  }
}

describe('ModelServiceSetupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabledModels = []
    mocks.providerEditorProps = null
    mocks.providers = [
      makeProvider('openai', { name: 'OpenAI' }),
      makeProvider('existing', { name: 'Existing Provider', isEnabled: true }),
      makeProvider('oauth-provider', { name: 'OAuth Provider', authType: 'oauth' })
    ]
  })

  it('searches provider names and ids and shows an empty result', () => {
    renderDialog()
    const search = screen.getByPlaceholderText('settings.provider.search')

    fireEvent.change(search, { target: { value: 'oauth-provider' } })
    expect(screen.getByRole('button', { name: /OAuth Provider/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /OpenAI/ })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByText('common.no_results')).toBeInTheDocument()
  })

  it('wires pinyin search into the provider list', () => {
    mocks.providers = [makeProvider('deepseek', { name: '深度求索' }), makeProvider('zhipu', { name: '智谱开放平台' })]
    renderDialog()
    const search = screen.getByPlaceholderText('settings.provider.search')

    fireEvent.change(search, { target: { value: 'shendu' } })
    expect(screen.getByRole('button', { name: /深度求索/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /智谱开放平台/ })).not.toBeInTheDocument()
  })

  it('opens model service settings directly', () => {
    const onResolve = vi.fn()
    renderDialog(onResolve)

    const settingsButton = screen.getByRole('button', {
      name: 'settings.provider.model_service_setup.manage_in_settings'
    })

    fireEvent.click(settingsButton)

    expect(onResolve).toHaveBeenCalledWith(null)
    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/provider')
  })

  it('opens standard API-key providers at the key or model step without an intermediate close delay', () => {
    mocks.providers = [
      makeProvider('without-key', { name: 'Without Key' }),
      makeProvider('with-key', {
        name: 'With Key',
        apiKeys: [{ id: 'key-id', isEnabled: true }] as Provider['apiKeys']
      })
    ]

    const { rerender } = render(
      <ModelServiceSetupDialog key="without-key" open setupContext="chat" onResolve={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /Without Key/ }))
    expect(screen.getByText('without-key:api-key')).toBeInTheDocument()

    rerender(<ModelServiceSetupDialog key="with-key" open setupContext="chat" onResolve={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /With Key/ }))
    expect(screen.getByText('with-key:models')).toBeInTheDocument()
  })

  it.each([
    {
      name: 'a special-auth provider',
      provider: makeProvider('oauth-provider', { name: 'OAuth Provider', authType: 'oauth' })
    },
    {
      name: 'an enabled provider with an enabled model',
      provider: makeProvider('existing', { name: 'Existing Provider', isEnabled: true })
    }
  ])('opens settings for $name without starting guided setup', ({ provider }) => {
    mocks.providers = [provider]
    if (provider.id === 'existing') {
      mocks.enabledModels = [makeModel('existing::chat', 'existing')]
    }
    const onResolve = vi.fn()
    renderDialog(onResolve)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(provider.name) }))

    expect(onResolve).toHaveBeenCalledWith(null)
    expect(mocks.openSettingsTab).toHaveBeenCalledWith(`/settings/provider?id=${provider.id}`)
    expect(screen.queryByRole('dialog', { name: 'api-setup' })).not.toBeInTheDocument()
  })

  it.each([
    { providerId: 'openai-codex', kind: 'managed-oauth' },
    { providerId: 'grok-cli', kind: 'managed-oauth' }
  ])('starts the in-dialog OAuth flow for $providerId', ({ providerId, kind }) => {
    mocks.providers = [makeProvider(providerId, { name: providerId, authType: 'oauth', authMethods: ['oauth'] })]
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(providerId) }))

    expect(screen.getByText(`${providerId}:${kind}`)).toBeInTheDocument()
    expect(mocks.openSettingsTab).not.toHaveBeenCalled()
  })

  it('hides Claude Code in chat and starts its terminal login flow for agents', () => {
    const claudeCode = makeProvider('claude-code', {
      name: 'Claude Code',
      authMethods: ['external-cli']
    })
    mocks.providers = [claudeCode]
    const { rerender } = renderDialog()

    expect(screen.queryByRole('button', { name: /Claude Code/ })).not.toBeInTheDocument()

    rerender(<ModelServiceSetupDialog open setupContext="agent" onResolve={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }))

    expect(screen.getByText('claude-code:external-cli')).toBeInTheDocument()
  })

  it('uses CherryIN OAuth without a key and skips to model selection with an existing key', () => {
    const withoutKey = makeProvider('cherryin', { name: 'CherryIN' })
    mocks.providers = [withoutKey]
    const { rerender } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /CherryIN/ }))
    expect(screen.getByText('cherryin:cherryin')).toBeInTheDocument()

    rerender(<ModelServiceSetupDialog key="cherryin-with-key" open setupContext="chat" onResolve={vi.fn()} />)
    mocks.providers = [
      makeProvider('cherryin', {
        name: 'CherryIN',
        apiKeys: [{ id: 'key-id', isEnabled: true }] as Provider['apiKeys']
      })
    ]
    rerender(<ModelServiceSetupDialog key="cherryin-with-key-loaded" open setupContext="chat" onResolve={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /CherryIN/ }))
    expect(screen.getByText('cherryin:models')).toBeInTheDocument()
  })

  it('starts directly from the requested provider for onboarding', async () => {
    mocks.providers = [makeProvider('cherryin', { name: 'CherryIN' })]

    render(<ModelServiceSetupDialog open setupContext="chat" initialProviderId="cherryin" onResolve={vi.fn()} />)

    expect(await screen.findByText('cherryin:cherryin')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('settings.provider.search')).not.toBeInTheDocument()
  })

  it('supports keyboard activation and preserves search when returning from setup', async () => {
    const user = userEvent.setup()
    mocks.providers = [makeProvider('openai', { name: 'OpenAI' })]
    renderDialog()
    const search = screen.getByPlaceholderText('settings.provider.search')
    fireEvent.change(search, { target: { value: 'open' } })
    const providerButton = screen.getByRole('button', { name: /OpenAI/ })
    providerButton.focus()

    await user.keyboard('{Enter}')
    fireEvent.click(await screen.findByRole('button', { name: 'back-to-providers' }))

    expect(screen.getByPlaceholderText('settings.provider.search')).toHaveValue('open')
  })

  it('returns to the same search after cancelling custom provider creation', () => {
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('settings.provider.search'), { target: { value: 'open' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.create_custom.title' }))

    expect(mocks.providerEditorProps?.seamlessTransitions).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'cancel-editor' }))

    expect(screen.getByPlaceholderText('settings.provider.search')).toHaveValue('open')
  })

  it.each([
    { action: 'create-without-key', expectedStep: 'api-key' },
    { action: 'create-with-key', expectedStep: 'models' }
  ])('continues a custom provider at the $expectedStep step', ({ action, expectedStep }) => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.create_custom.title' }))
    fireEvent.click(screen.getByRole('button', { name: action }))

    expect(screen.getByText(`custom-provider:${expectedStep}`)).toBeInTheDocument()
  })

  it('returns configured models only after the guided setup reports success', () => {
    const onResolve = vi.fn()
    mocks.providers = [makeProvider('openai', { name: 'OpenAI' })]
    renderDialog(onResolve)
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }))

    fireEvent.click(screen.getByRole('button', { name: 'finish-api-setup' }))

    expect(onResolve).toHaveBeenCalledWith([makeModel('custom-provider::chat', 'custom-provider')])
  })
})
