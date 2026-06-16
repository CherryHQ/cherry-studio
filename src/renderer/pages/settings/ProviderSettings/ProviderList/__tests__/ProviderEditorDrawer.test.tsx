import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderEditorDrawer from '../ProviderEditorDrawer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabelKey: (id: string) => id
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled, loading, ...props }: any) => (
    <button type="button" onClick={onClick} disabled={disabled || loading} {...props}>
      {children}
    </button>
  ),
  Input: ({ onChange, onKeyDown, value, placeholder, ...props }: any) => (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      onChange={onChange}
      onKeyDown={onKeyDown}
      aria-label={placeholder}
      {...props}
    />
  ),
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>
}))

vi.mock('@renderer/components/ProviderAvatar', () => ({
  ProviderAvatarPrimitive: () => <div>avatar</div>
}))

vi.mock('@renderer/components/ProviderLogoPicker', () => ({
  default: () => <div>logo-picker</div>
}))

vi.mock('@renderer/utils', () => ({
  compressImage: vi.fn(),
  convertToBase64: vi.fn(),
  generateColorFromChar: vi.fn(),
  getForegroundColor: vi.fn(),
  cn: (...args: any[]) => args.filter(Boolean).join(' ')
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, footer, open, title }: any) =>
    open ? (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null
}))

describe('ProviderEditorDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.toast = {
      error: vi.fn()
    } as unknown as typeof window.toast
  })

  it('submits a create-custom payload with api-key auth and OPENAI_CHAT_COMPLETIONS as the default endpoint', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    expect(screen.getByText('settings.provider.create_custom.title')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'My Custom' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.provider.base_url.placeholder'), {
      target: { value: 'https://api.example.com' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Custom',
        defaultChatEndpoint: 'openai-chat-completions',
        authConfig: { type: 'api-key' },
        endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://api.example.com' } }
      })
    )
    const callArg = onSubmit.mock.calls[0]?.[0] as { presetProviderId?: string } | undefined
    expect(callArg?.presetProviderId).toBeUndefined()
  })

  it('uses a duplicate-specific submit label when mode is duplicate', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'duplicate',
          source: {
            id: 'openai-2',
            name: 'OpenAI Personal',
            presetProviderId: 'openai',
            defaultChatEndpoint: 'openai-chat-completions',
            authType: 'api-key'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'settings.provider.duplicate.menu_label' })).toBeInTheDocument()
  })

  it('duplicate of an iam-azure source: keeps source defaultChatEndpoint + iam-azure auth, URL-keyed off it', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'duplicate',
          source: {
            id: 'azure-1',
            name: 'Azure 1',
            presetProviderId: 'azure-openai',
            defaultChatEndpoint: 'azure-openai-chat-completions',
            authType: 'iam-azure'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Azure 2' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.provider.base_url.placeholder'), {
      target: { value: 'https://az.example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.duplicate.menu_label' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'create',
        name: 'Azure 2',
        defaultChatEndpoint: 'azure-openai-chat-completions',
        presetProviderId: 'azure-openai',
        authConfig: { type: 'iam-azure', apiVersion: '' },
        endpointConfigs: { 'azure-openai-chat-completions': { baseUrl: 'https://az.example.com' } }
      })
    )
  })

  it('duplicate of an iam-aws source: no URL/api-key fields, region-bearing auth, source endpoint', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'duplicate',
          source: {
            id: 'aws-bedrock',
            name: 'Bedrock',
            presetProviderId: 'aws-bedrock',
            defaultChatEndpoint: 'anthropic-messages',
            authType: 'iam-aws'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    expect(screen.queryByPlaceholderText('settings.provider.base_url.placeholder')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Bedrock 2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.duplicate.menu_label' }))

    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      mode: 'create',
      name: 'Bedrock 2',
      defaultChatEndpoint: 'anthropic-messages',
      presetProviderId: 'aws-bedrock',
      authConfig: { type: 'iam-aws', region: '' }
    })
    expect(payload.endpointConfigs).toBeUndefined()
    expect(payload.apiKeys).toBeUndefined()
  })

  it('duplicate of an api-key-aws source: emptyAuthConfigFor yields region-bearing api-key-aws', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'duplicate',
          source: {
            id: 'aws-bedrock',
            name: 'Bedrock',
            presetProviderId: 'aws-bedrock',
            defaultChatEndpoint: 'anthropic-messages',
            authType: 'api-key-aws'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Bedrock 2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.duplicate.menu_label' }))

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      mode: 'create',
      authConfig: { type: 'api-key-aws', region: '' }
    })
  })

  it('preserves provider type semantics on edit (defaultChatEndpoint not switched, no presetProviderId leak)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'edit',
          provider: {
            id: 'openai-work',
            name: 'OpenAI Work',
            presetProviderId: 'openai',
            defaultChatEndpoint: 'openai-chat-completions'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    expect(screen.getByText('common.edit')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'OpenAI Work',
        defaultChatEndpoint: 'openai-chat-completions'
      })
    )
    const payload = onSubmit.mock.calls[0]?.[0] as { presetProviderId?: string; authConfig?: unknown } | undefined
    expect(payload?.presetProviderId).toBeUndefined()
    expect(payload?.authConfig).toBeUndefined()
  })
})
