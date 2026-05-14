import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderEditorDrawer from '../ProviderEditorDrawer'

const selectDropdownMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled, loading, ...props }: any) => (
    <button type="button" onClick={onClick} disabled={disabled || loading} {...props}>
      {children}
    </button>
  ),
  Input: ({ onChange, onKeyDown, ...props }: any) => <input onChange={onChange} onKeyDown={onKeyDown} {...props} />,
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  SelectDropdown: (props: any) => {
    selectDropdownMock(props)
    return <div data-testid="provider-template-select" />
  }
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
  getForegroundColor: vi.fn()
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, footer, open }: any) =>
    open ? (
      <div>
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

  it('renders the template selector only in create mode', () => {
    render(<ProviderEditorDrawer open initialLogo={undefined} onClose={vi.fn()} onSubmit={vi.fn()} />)

    expect(screen.getByTestId('provider-template-select')).toBeInTheDocument()
  })

  it('locks the template when editing so submit cannot switch provider type semantics', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <ProviderEditorDrawer
        open
        provider={
          {
            id: 'openai-work',
            name: 'OpenAI Work',
            presetProviderId: 'openai',
            defaultChatEndpoint: 'openai-chat-completions'
          } as any
        }
        initialLogo={undefined}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    expect(screen.queryByTestId('provider-template-select')).not.toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'OpenAI Work',
        defaultChatEndpoint: 'openai-chat-completions',
        presetProviderId: undefined,
        authConfig: undefined
      })
    )
  })
})
