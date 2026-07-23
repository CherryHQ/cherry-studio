import { toast } from '@renderer/services/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderEditorDrawer from '../ProviderEditorDrawer'

const mocks = vi.hoisted(() => ({
  providerAvatarPrimitive: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => (values?.path ? `${key}:${values.path}` : key)
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
  Field: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  FieldSet: ({ children, ...props }: any) => <fieldset {...props}>{children}</fieldset>,
  FieldLegend: ({ children, ...props }: any) => <legend {...props}>{children}</legend>,
  FieldLabel: ({ children, required, ...props }: any) => (
    <label {...props}>
      {children}
      {required ? <span aria-hidden="true">*</span> : null}
    </label>
  ),
  FieldError: ({ errors, children, ...props }: any) => {
    const content = children ?? errors?.[0]?.message
    if (!content) return null
    return (
      <div role="alert" {...props}>
        {content}
      </div>
    )
  },
  RadioGroup: ({ children, onValueChange, ...props }: any) => (
    <div
      role="radiogroup"
      onChange={(event: any) => {
        onValueChange?.(event.target.value)
      }}
      {...props}>
      {children}
    </div>
  ),
  RadioGroupItem: ({ value, ...props }: any) => <input type="radio" value={value} {...props} />,
  Combobox: ({ options = [], onChange, placeholder, value }: any) => (
    <select
      aria-label={placeholder}
      value={Array.isArray(value) ? (value[0] ?? '') : (value ?? '')}
      onChange={(event) => onChange?.(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Select: ({ children, onValueChange }: any) => (
    <div
      onClick={(event) => {
        const option = (event.target as HTMLElement).closest<HTMLElement>('[data-select-value]')
        if (option?.dataset.selectValue) {
          onValueChange?.(option.dataset.selectValue)
        }
      }}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <button type="button" data-select-value={value} aria-label={children}>
      {children}
    </button>
  ),
  Accordion: ({ children }: any) => <div>{children}</div>,
  AccordionItem: ({ children }: any) => <div>{children}</div>,
  AccordionTrigger: ({ children }: any) => <button type="button">{children}</button>,
  AccordionContent: () => null,
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange?.(event.target.checked)} {...props} />
  ),
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>
}))

vi.mock('@renderer/components/ProviderAvatar', () => ({
  ProviderAvatarPrimitive: (props: any) => {
    mocks.providerAvatarPrimitive(props)
    return <div data-testid="provider-avatar-preview" data-logo={props.logo ?? ''} />
  }
}))

vi.mock('@renderer/components/ProviderLogoPicker', () => ({
  default: ({ onProviderClick }: { onProviderClick: (providerId: string) => void }) => (
    <button type="button" onClick={() => onProviderClick('openai')}>
      pick-openai
    </button>
  )
}))

vi.mock('@renderer/utils/style', () => ({
  generateColorFromChar: vi.fn(),
  getForegroundColor: vi.fn(),
  cn: (...args: any[]) => args.filter(Boolean).join(' ')
}))

vi.mock('@renderer/utils/uuid', () => ({
  uuid: () => 'api-key-id'
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

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

function selectCompatibility(type: 'new_api' | 'openai' | 'anthropic' | 'gemini' | 'custom' = 'openai') {
  fireEvent.click(
    screen.getByLabelText(new RegExp(`settings\\.provider\\.create_custom\\.compatibility\\.${type}\\.label`))
  )
}

describe('ProviderEditorDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has no object-URL impl; stub so the staged-upload preview path runs.
    URL.createObjectURL = vi.fn(() => 'blob:provider-logo')
    URL.revokeObjectURL = vi.fn()
  })

  it('stages an uploaded logo and previews it via an object URL', async () => {
    const file = new File(['png'], 'avatar.png', { type: 'image/png' })

    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'edit',
          provider: {
            id: 'custom-provider',
            name: 'Custom Provider',
            defaultChatEndpoint: 'openai-chat-completions'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] }
    })

    await waitFor(() => {
      expect(screen.getByTestId('provider-avatar-preview')).toHaveAttribute('data-logo', 'blob:provider-logo')
    })
  })

  it('rejects an oversize logo at pick time without staging a preview', () => {
    const file = new File(['png'], 'avatar.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })

    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'edit',
          provider: {
            id: 'custom-provider',
            name: 'Custom Provider',
            defaultChatEndpoint: 'openai-chat-completions'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] }
    })

    expect(vi.mocked(toast.error)).toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('submits the uploaded logo as an image edit (raw file, no pre-store)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const file = new File(['png'], 'avatar.png', { type: 'image/png' })

    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'edit',
          provider: {
            id: 'custom-provider',
            name: 'Custom Provider',
            defaultChatEndpoint: 'openai-chat-completions'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] }
    })
    await waitFor(() => expect(screen.getByTestId('provider-avatar-preview')).toHaveAttribute('data-logo'))

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'edit',
          name: 'Custom Provider',
          logo: expect.objectContaining({ kind: 'image' })
        })
      )
    })
  })

  it('submits a default logo edit when reset before saving', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const file = new File(['png'], 'avatar.png', { type: 'image/png' })

    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'edit',
          provider: {
            id: 'custom-provider',
            name: 'Custom Provider',
            defaultChatEndpoint: 'openai-chat-completions'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] }
    })
    await waitFor(() => expect(screen.getByTestId('provider-avatar-preview')).toHaveAttribute('data-logo'))

    fireEvent.click(screen.getByRole('button', { name: 'settings.general.avatar.reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'edit',
          name: 'Custom Provider',
          logo: { kind: 'default' }
        })
      )
    })
  })

  it('submits a preset-key logo edit when an icon is selected after uploading', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const file = new File(['png'], 'avatar.png', { type: 'image/png' })

    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'edit',
          provider: {
            id: 'custom-provider',
            name: 'Custom Provider',
            defaultChatEndpoint: 'openai-chat-completions'
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] }
    })
    await waitFor(() => expect(screen.getByTestId('provider-avatar-preview')).toHaveAttribute('data-logo'))

    fireEvent.click(screen.getByRole('button', { name: 'pick-openai' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'edit',
          name: 'Custom Provider',
          logo: { kind: 'key', key: 'icon:openai' }
        })
      )
    })
  })

  it('submits an OpenAI-compatible payload with Chat Completions as the default endpoint', () => {
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
    selectCompatibility()

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

  it('places provider identity before compatibility and does not show a recommendation badge', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    const avatar = screen.getByTestId('provider-avatar-preview')
    const nameInput = screen.getByPlaceholderText('settings.provider.add.name.placeholder')
    const compatibilitySelect = screen.getByRole('button', {
      name: 'settings.provider.create_custom.compatibility.label'
    })

    expect(avatar.compareDocumentPosition(nameInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nameInput.compareDocumentPosition(compatibilitySelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      screen.queryByText('settings.provider.create_custom.compatibility.new_api.recommended')
    ).not.toBeInTheDocument()
  })

  it('requires an explicit compatibility type before showing connection fields', () => {
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

    expect(screen.queryByLabelText('settings.provider.base_url.label')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('settings.provider.create_custom.compatibility.required')).toBeInTheDocument()
  })

  it('submits New API with its preset and all canonical text endpoints', () => {
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

    selectCompatibility('new_api')
    fireEvent.change(screen.getByPlaceholderText('settings.provider.base_url.placeholder'), {
      target: { value: 'https://new-api.example.com' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'New API' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        presetProviderId: 'new-api',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://new-api.example.com' },
          'openai-responses': { baseUrl: 'https://new-api.example.com' },
          'anthropic-messages': { baseUrl: 'https://new-api.example.com' },
          'google-generate-content': { baseUrl: 'https://new-api.example.com' }
        }
      })
    )
  })

  it('preserves connection values while switching compatibility and updates the request preview', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    selectCompatibility('anthropic')
    fireEvent.change(screen.getByPlaceholderText('settings.provider.base_url.placeholder'), {
      target: { value: 'https://api.example.com' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), {
      target: { value: 'secret' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Compatible API' }
    })

    expect(
      screen.getByText('settings.provider.create_custom.request_preview:https://api.example.com/v1/messages')
    ).toBeInTheDocument()

    selectCompatibility('gemini')

    expect(screen.getByPlaceholderText('settings.provider.base_url.placeholder')).toHaveValue('https://api.example.com')
    expect(screen.getByLabelText('settings.provider.api_key.label')).toHaveValue('secret')
    expect(screen.getByPlaceholderText('settings.provider.add.name.placeholder')).toHaveValue('Compatible API')
    expect(
      screen.getByText(
        'settings.provider.create_custom.request_preview:https://api.example.com/v1beta/models/{model}:generateContent'
      )
    ).toBeInTheDocument()
  })

  it('switches Advanced Custom to a preset instance while preserving identity and basic connection fields', () => {
    const onSelectPreset = vi.fn()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const source = {
      id: 'anthropic',
      name: 'Anthropic',
      presetProviderId: 'anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { baseUrl: 'https://api.anthropic.com' }
      },
      authType: 'api-key'
    } as any
    const sharedProps = {
      open: true,
      initialLogo: undefined,
      presetSources: [source],
      onClose: vi.fn(),
      onSelectPreset,
      onSubmit
    }

    const { rerender } = render(<ProviderEditorDrawer {...sharedProps} mode={{ kind: 'create-custom' }} />)

    selectCompatibility('custom')
    fireEvent.click(screen.getByRole('button', { name: 'pick-openai' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Claude Gateway' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.provider.base_url.placeholder'), {
      target: { value: 'https://gateway.example.com' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), {
      target: { value: 'secret' }
    })
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'settings.provider.create_custom.preset_instance.placeholder'
      }),
      { target: { value: 'anthropic' } }
    )

    expect(onSelectPreset).toHaveBeenCalledWith(source)

    rerender(<ProviderEditorDrawer {...sharedProps} mode={{ kind: 'duplicate', source }} />)

    const nameInput = screen.getByPlaceholderText('settings.provider.add.name.placeholder')
    expect(nameInput).toHaveValue('Claude Gateway')
    expect(screen.getByPlaceholderText('settings.provider.base_url.placeholder')).toHaveValue(
      'https://gateway.example.com'
    )
    expect(screen.getByLabelText('settings.provider.api_key.label')).toHaveValue('secret')
    expect(mocks.providerAvatarPrimitive).toHaveBeenCalledWith(
      expect.objectContaining({ logo: 'icon:openai', providerName: 'Claude Gateway' })
    )
    expect(
      nameInput.compareDocumentPosition(screen.getByText('anthropic')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.duplicate.menu_label' }))

    expect(onSubmit).toHaveBeenCalledWith({
      mode: 'create',
      name: 'Claude Gateway',
      defaultChatEndpoint: 'anthropic-messages',
      presetProviderId: 'anthropic',
      authConfig: { type: 'api-key' },
      endpointConfigs: {
        'anthropic-messages': { baseUrl: 'https://gateway.example.com' }
      },
      apiKeys: [{ id: 'api-key-id', key: 'secret', isEnabled: true }],
      logo: { kind: 'key', key: 'icon:openai' }
    })
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

  it('shows a required error and does not submit when the name is empty on create-custom', () => {
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
    selectCompatibility()

    // Fill the base URL so the button is enabled, but leave the name empty.
    fireEvent.change(screen.getByPlaceholderText('settings.provider.base_url.placeholder'), {
      target: { value: 'https://api.example.com' }
    })
    expect(screen.queryByText('settings.provider.add.name.required')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('settings.provider.add.name.required')).toBeInTheDocument()
  })

  it('shows the required error after the name input is blurred while empty', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    selectCompatibility()

    fireEvent.blur(screen.getByPlaceholderText('settings.provider.add.name.placeholder'))

    expect(screen.getByText('settings.provider.add.name.required')).toBeInTheDocument()
  })

  it('clears the required error once a valid name is entered', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    selectCompatibility()

    const nameInput = screen.getByPlaceholderText('settings.provider.add.name.placeholder')
    fireEvent.blur(nameInput)
    expect(screen.getByText('settings.provider.add.name.required')).toBeInTheDocument()

    fireEvent.change(nameInput, { target: { value: 'My Custom' } })
    expect(screen.queryByText('settings.provider.add.name.required')).not.toBeInTheDocument()
  })

  it('shows a base URL required error and does not submit when the base URL is empty on create-custom', () => {
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
    selectCompatibility()

    // Fill the name so the only thing missing is the base URL.
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'My Custom' }
    })
    expect(screen.queryByText('settings.provider.base_url.required')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('settings.provider.base_url.required')).toBeInTheDocument()
  })

  it('shows the base URL required error after the base URL input is blurred while empty', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    selectCompatibility()

    fireEvent.blur(screen.getByPlaceholderText('settings.provider.base_url.placeholder'))

    expect(screen.getByText('settings.provider.base_url.required')).toBeInTheDocument()
  })

  it('clears the base URL required error once a valid base URL is entered', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    selectCompatibility()

    const baseUrlInput = screen.getByPlaceholderText('settings.provider.base_url.placeholder')
    fireEvent.blur(baseUrlInput)
    expect(screen.getByText('settings.provider.base_url.required')).toBeInTheDocument()

    fireEvent.change(baseUrlInput, { target: { value: 'https://api.example.com' } })
    expect(screen.queryByText('settings.provider.base_url.required')).not.toBeInTheDocument()
  })

  it('name input: label is bound via htmlFor and aria-describedby links to the error node when error is visible', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    selectCompatibility()

    const nameInput = screen.getByPlaceholderText('settings.provider.add.name.placeholder')

    expect(nameInput).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.querySelector(`label[for="${nameInput.id}"]`)).toBeInTheDocument()

    fireEvent.blur(nameInput)

    const errorId = nameInput.getAttribute('aria-describedby')
    expect(errorId).toBeTruthy()
    const errorNode = document.getElementById(errorId!)
    expect(errorNode).toHaveAttribute('role', 'alert')
    expect(errorNode).toHaveTextContent('settings.provider.add.name.required')
  })

  it('base URL input: label is bound via htmlFor and aria-describedby links to the error node when error is visible', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    selectCompatibility()

    const baseUrlInput = screen.getByPlaceholderText('settings.provider.base_url.placeholder')

    expect(baseUrlInput).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.querySelector(`label[for="${baseUrlInput.id}"]`)).toBeInTheDocument()

    fireEvent.blur(baseUrlInput)

    const errorId = baseUrlInput.getAttribute('aria-describedby')
    expect(errorId).toBeTruthy()
    const errorNode = document.getElementById(errorId!)
    expect(errorNode).toHaveAttribute('role', 'alert')
    expect(errorNode).toHaveTextContent('settings.provider.base_url.required')
  })

  it('does not require the base URL in duplicate mode (optional, no error on blur)', () => {
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

    fireEvent.blur(screen.getByPlaceholderText('settings.provider.base_url.placeholder'))

    expect(screen.queryByText('settings.provider.base_url.required')).not.toBeInTheDocument()
  })
})
