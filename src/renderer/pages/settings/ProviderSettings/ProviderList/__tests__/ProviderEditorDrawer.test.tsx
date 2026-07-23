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

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const AccordionContext = React.createContext<{ value: string; onValueChange?: (value: string) => void }>({
    value: ''
  })
  const AccordionItemContext = React.createContext('')

  return {
    Accordion: ({ children, value, onValueChange }: any) => (
      <AccordionContext value={{ value, onValueChange }}>
        <div>{children}</div>
      </AccordionContext>
    ),
    AccordionItem: ({ children, value, ...props }: any) => (
      <AccordionItemContext value={value}>
        <div {...props}>{children}</div>
      </AccordionItemContext>
    ),
    AccordionTrigger: ({ children, ...props }: any) => {
      const accordion = React.use(AccordionContext)
      const itemValue = React.use(AccordionItemContext)
      const expanded = accordion.value === itemValue
      return (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => accordion.onValueChange?.(expanded ? '' : itemValue)}
          {...props}>
          {children}
        </button>
      )
    },
    AccordionContent: ({ children, ...props }: any) => {
      const accordion = React.use(AccordionContext)
      const itemValue = React.use(AccordionItemContext)
      const domProps = { ...props }
      delete domProps.contentClassName
      return accordion.value === itemValue ? <div {...domProps}>{children}</div> : null
    },
    Badge: ({ children, ...props }: any) => {
      const domProps = { ...props }
      delete domProps.variant
      return (
        <span data-slot="badge" {...domProps}>
          {children}
        </span>
      )
    },
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
    Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog-root">{children}</div> : null),
    DialogContent: ({ children, size, ...props }: any) => {
      const domProps = { ...props }
      delete domProps.closeOnOverlayClick
      delete domProps.showCloseButton
      return (
        <div data-size={size} {...domProps}>
          {children}
        </div>
      )
    },
    DialogFooter: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    DialogHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    DialogTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
    Popover: ({ children }: any) => <div>{children}</div>,
    PopoverContent: ({ children }: any) => <div>{children}</div>,
    PopoverTrigger: ({ children }: any) => <div>{children}</div>
  }
})

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
      <div data-testid="provider-editor-drawer">
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

function toggleMoreSettings() {
  fireEvent.click(
    screen.getByRole('button', {
      name: /settings\.provider\.create_custom\.endpoint_fields\.more/
    })
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

  it('uses a dialog for create and duplicate flows while keeping edit in the drawer', () => {
    const commonProps = {
      open: true,
      initialLogo: undefined,
      onClose: vi.fn(),
      onSubmit: vi.fn()
    }

    const { rerender } = render(<ProviderEditorDrawer {...commonProps} mode={{ kind: 'create-custom' }} />)

    expect(screen.getByTestId('provider-editor-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('provider-editor-dialog')).toHaveAttribute('data-size', 'xl')
    expect(screen.queryByTestId('provider-editor-drawer')).not.toBeInTheDocument()

    const source = {
      id: 'openai',
      name: 'OpenAI',
      presetProviderId: 'openai',
      defaultChatEndpoint: 'openai-chat-completions',
      authType: 'api-key'
    } as any
    rerender(<ProviderEditorDrawer {...commonProps} mode={{ kind: 'duplicate', source }} />)
    expect(screen.getByTestId('provider-editor-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('provider-editor-dialog')).toHaveAttribute('data-size', 'xl')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByLabelText('settings.provider.more_endpoints.openai_chat')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.provider.more_endpoints.anthropic')).toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.more_endpoints.openai_responses')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /settings\.provider\.create_custom\.endpoint_fields\.more/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'settings.provider.more_endpoints.toggle' })).not.toBeInTheDocument()

    rerender(
      <ProviderEditorDrawer
        {...commonProps}
        mode={{
          kind: 'edit',
          provider: { id: 'custom', name: 'Custom', defaultChatEndpoint: 'openai-chat-completions' } as any
        }}
      />
    )
    expect(screen.getByTestId('provider-editor-drawer')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-editor-dialog')).not.toBeInTheDocument()
  })

  it('submits a Chat Completions endpoint without assigning a preset', () => {
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
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'), {
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

  it('uses the first configured common text endpoint as the default', () => {
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

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Anthropic Gateway' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.anthropic'), {
      target: { value: 'https://anthropic.example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'https://anthropic.example.com' }
        }
      })
    )
  })

  it('shows common endpoints first and keeps the optional preset last inside More options', () => {
    const source = {
      id: 'anthropic',
      name: 'Anthropic',
      presetProviderId: 'anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } },
      authType: 'api-key'
    } as any
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        presetSources={[source]}
        onClose={vi.fn()}
        onSelectPreset={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    const avatar = screen.getByTestId('provider-avatar-preview')
    const nameInput = screen.getByPlaceholderText('settings.provider.add.name.placeholder')
    const apiKeyInput = screen.getByLabelText('settings.provider.api_key.label')
    const chatInput = screen.getByLabelText('settings.provider.more_endpoints.openai_chat')
    const anthropicInput = screen.getByLabelText('settings.provider.more_endpoints.anthropic')
    const moreTrigger = screen.getByRole('button', {
      name: /settings\.provider\.create_custom\.endpoint_fields\.more/
    })

    expect(avatar.compareDocumentPosition(nameInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nameInput.compareDocumentPosition(apiKeyInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(apiKeyInput.compareDocumentPosition(chatInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chatInput.compareDocumentPosition(anthropicInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(anthropicInput.compareDocumentPosition(moreTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(moreTrigger).toHaveClass('min-h-10', 'cursor-pointer')
    expect(moreTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('settings.provider.more_endpoints.openai_responses')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', {
        name: 'settings.provider.create_custom.preset_instance.placeholder'
      })
    ).not.toBeInTheDocument()

    toggleMoreSettings()

    const presetPicker = screen.getByRole('combobox', {
      name: 'settings.provider.create_custom.preset_instance.placeholder'
    })
    const responsesInput = screen.getByLabelText('settings.provider.more_endpoints.openai_responses')
    const imageEditInput = screen.getByLabelText('settings.provider.image_endpoints.image_edit_base_url.label')
    expect(moreTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(moreTrigger.compareDocumentPosition(responsesInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(imageEditInput.compareDocumentPosition(presetPicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('settings.provider.create_custom.compatibility.label')).not.toBeInTheDocument()
  })

  it('requires at least one text endpoint', () => {
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

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Images Only' }
    })
    toggleMoreSettings()
    fireEvent.change(screen.getByLabelText('settings.provider.image_endpoints.image_generation_base_url.label'), {
      target: { value: 'https://images.example.com' }
    })
    toggleMoreSettings()
    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText('settings.provider.create_custom.endpoint_fields.text_endpoint_required')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('settings.provider.more_endpoints.openai_chat')).toBeInTheDocument()
  })

  it('submits multiple independent text and image endpoints with an explicit default chat endpoint', () => {
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

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Multi Protocol' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'), {
      target: { value: 'https://chat.example.com' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.anthropic'), {
      target: { value: 'https://anthropic.example.com' }
    })
    const defaultBadge = screen.getByText('settings.provider.create_custom.endpoint_fields.default_chat')
    const setDefaultButton = screen.getByRole('button', {
      name: 'settings.provider.create_custom.endpoint_fields.set_default_chat'
    })
    expect(defaultBadge).toHaveAttribute('data-slot', 'badge')
    expect(setDefaultButton).toHaveClass('h-6', 'rounded-full', 'active:scale-[0.96]')
    expect(
      screen.getByLabelText('settings.provider.more_endpoints.openai_chat').previousElementSibling
    ).toContainElement(defaultBadge)
    expect(screen.getByLabelText('settings.provider.more_endpoints.anthropic').previousElementSibling).toContainElement(
      setDefaultButton
    )
    fireEvent.click(setDefaultButton)
    toggleMoreSettings()
    fireEvent.change(screen.getByLabelText('settings.provider.image_endpoints.image_generation_base_url.label'), {
      target: { value: 'https://images.example.com' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.image_endpoints.image_edit_base_url.label'), {
      target: { value: 'https://edits.example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://chat.example.com' },
          'anthropic-messages': { baseUrl: 'https://anthropic.example.com' },
          'openai-image-generation': { baseUrl: 'https://images.example.com' },
          'openai-image-edit': { baseUrl: 'https://edits.example.com' }
        }
      })
    )
  })

  it('preserves advanced endpoint values while collapsing More options and updates request previews', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'), {
      target: { value: 'https://chat.example.com' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), {
      target: { value: 'secret' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Compatible API' }
    })

    expect(
      screen.getByText('settings.provider.create_custom.request_preview:https://chat.example.com/v1/chat/completions')
    ).toBeInTheDocument()

    toggleMoreSettings()
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.gemini'), {
      target: { value: 'https://gemini.example.com' }
    })

    expect(screen.getByLabelText('settings.provider.api_key.label')).toHaveValue('secret')
    expect(screen.getByPlaceholderText('settings.provider.add.name.placeholder')).toHaveValue('Compatible API')
    expect(
      screen.getByText(
        'settings.provider.create_custom.request_preview:https://gemini.example.com/v1beta/models/{model}:generateContent'
      )
    ).toBeInTheDocument()

    toggleMoreSettings()
    expect(screen.queryByLabelText('settings.provider.more_endpoints.gemini')).not.toBeInTheDocument()
    expect(screen.getByText('settings.provider.create_custom.endpoint_fields.more_configured')).toBeInTheDocument()
    toggleMoreSettings()
    expect(screen.getByLabelText('settings.provider.more_endpoints.gemini')).toHaveValue('https://gemini.example.com')
    expect(screen.getByLabelText('settings.provider.more_endpoints.openai_chat')).toHaveValue(
      'https://chat.example.com'
    )
  })

  it('switches to a preset instance while preserving identity and basic connection fields', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'pick-openai' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'Claude Gateway' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'), {
      target: { value: 'https://gateway.example.com' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), {
      target: { value: 'secret' }
    })
    toggleMoreSettings()
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
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByLabelText('settings.provider.more_endpoints.openai_chat')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.provider.more_endpoints.anthropic')).toHaveValue(
      'https://gateway.example.com'
    )
    expect(
      screen.queryByRole('button', { name: 'settings.provider.create_custom.endpoint_fields.set_default_chat' })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.more_endpoints.openai_responses')).not.toBeInTheDocument()
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

  it('fans one Base URL out to all canonical text endpoints for a New API preset instance', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProviderEditorDrawer
        open
        mode={{
          kind: 'duplicate',
          source: {
            id: 'new-api',
            name: 'New API',
            presetProviderId: 'new-api',
            authType: 'api-key',
            endpointConfigs: {
              'openai-chat-completions': { baseUrl: 'http://localhost:3000' },
              'openai-responses': { baseUrl: 'http://localhost:3000' },
              'anthropic-messages': { baseUrl: 'http://localhost:3000' },
              'google-generate-content': { baseUrl: 'http://localhost:3000' }
            }
          } as any
        }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'New API Work' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'), {
      target: { value: 'https://new-api.example.com' }
    })
    toggleMoreSettings()
    expect(screen.getByLabelText('settings.provider.more_endpoints.openai_responses')).toHaveValue(
      'https://new-api.example.com'
    )
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_responses'), {
      target: { value: 'https://responses.example.com' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.image_endpoints.image_generation_base_url.label'), {
      target: { value: 'https://images.example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.duplicate.menu_label' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        presetProviderId: 'new-api',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://new-api.example.com' },
          'openai-responses': { baseUrl: 'https://responses.example.com' },
          'anthropic-messages': { baseUrl: 'https://new-api.example.com' },
          'google-generate-content': { baseUrl: 'https://new-api.example.com' },
          'openai-image-generation': { baseUrl: 'https://images.example.com' }
        }
      })
    )
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
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
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
    expect(screen.queryByLabelText('settings.provider.api_key.label')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
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

    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'), {
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

    const nameInput = screen.getByPlaceholderText('settings.provider.add.name.placeholder')
    fireEvent.blur(nameInput)
    expect(screen.getByText('settings.provider.add.name.required')).toBeInTheDocument()

    fireEvent.change(nameInput, { target: { value: 'My Custom' } })
    expect(screen.queryByText('settings.provider.add.name.required')).not.toBeInTheDocument()
  })

  it('expands More options to reveal an invalid advanced endpoint and does not submit', () => {
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

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'My Custom' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'), {
      target: { value: 'https://chat.example.com' }
    })
    toggleMoreSettings()
    const endpointInput = screen.getByLabelText('settings.provider.more_endpoints.openai_responses')
    fireEvent.change(endpointInput, { target: { value: 'not-a-url' } })
    toggleMoreSettings()

    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('settings.provider.base_url.invalid')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.provider.more_endpoints.openai_responses')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(
      screen.getByRole('button', { name: /settings\.provider\.create_custom\.endpoint_fields\.more/ })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('clears an endpoint URL error once a valid URL is entered', () => {
    render(
      <ProviderEditorDrawer
        open
        mode={{ kind: 'create-custom' }}
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('settings.provider.add.name.placeholder'), {
      target: { value: 'My Custom' }
    })
    const endpointInput = screen.getByLabelText('settings.provider.more_endpoints.openai_chat')
    fireEvent.change(endpointInput, { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'button.add' }))
    expect(screen.getByText('settings.provider.base_url.invalid')).toBeInTheDocument()

    fireEvent.change(endpointInput, { target: { value: 'https://api.example.com' } })
    expect(screen.queryByText('settings.provider.base_url.invalid')).not.toBeInTheDocument()
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

    fireEvent.blur(screen.getByLabelText('settings.provider.more_endpoints.openai_chat'))

    expect(screen.queryByText('settings.provider.base_url.required')).not.toBeInTheDocument()
  })
})
