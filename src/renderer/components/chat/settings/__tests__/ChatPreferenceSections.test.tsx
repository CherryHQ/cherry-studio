import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatPreferenceSections from '../ChatPreferenceSections'

const mocks = vi.hoisted(() => ({
  setPreference: vi.fn(),
  preferenceValues: {
    'chat.message.style': 'plain',
    'chat.message.font_size': 14,
    'chat.input.send_message_shortcut': 'Enter',
    'chat.message.font': 'system',
    'chat.message.confirm_delete': true,
    'chat.message.navigation_mode': 'none',
    'chat.narrow_mode': true,
    'chat.message.thought.auto_collapse': true,
    'chat.message.multi_model.style': 'horizontal',
    'chat.message.math.single_dollar': true,
    'chat.input.show_estimated_tokens': false,
    'chat.message.render_as_markdown': false,
    'chat.message.show_outline': false,
    'chat.code.show_line_numbers': false,
    'chat.code.collapsible': false,
    'chat.code.wrappable': false,
    'chat.code.image_tools': false,
    'chat.code.editor.enabled': false,
    'chat.code.editor.theme_light': 'auto',
    'chat.code.editor.theme_dark': 'auto',
    'chat.code.editor.highlight_active_line': false,
    'chat.code.editor.fold_gutter': false,
    'chat.code.editor.autocompletion': true,
    'chat.code.editor.keymap': false,
    'chat.code.viewer.theme_light': 'auto',
    'chat.code.viewer.theme_dark': 'auto',
    'chat.code.execution.enabled': false,
    'chat.code.execution.timeout_minutes': 1,
    'chat.code.fancy_block': true
  } as Record<string, unknown>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [
    mocks.preferenceValues[key],
    (value: unknown) => {
      mocks.preferenceValues[key] = value
      mocks.setPreference(key, value)
    }
  ],
  useMultiplePreferences: (schema: Record<string, string>) => [
    Object.fromEntries(Object.entries(schema).map(([field, key]) => [field, mocks.preferenceValues[key]])),
    vi.fn()
  ]
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ themeNames: ['auto', 'github'] })
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  Divider: ({ className }: { className?: string }) => <hr className={className} />,
  Select: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: PropsWithChildren) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: ReactNode }) => <span>{placeholder}</span>,
  Switch: ({
    'aria-label': ariaLabel,
    checked,
    onCheckedChange
  }: {
    'aria-label'?: string
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      data-checked={String(Boolean(checked))}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('ChatPreferenceSections', () => {
  beforeEach(() => {
    mocks.preferenceValues['chat.narrow_mode'] = true
    mocks.setPreference.mockClear()
  })

  it('renders message and code-block display settings in the display variant', () => {
    render(<ChatPreferenceSections variant="display" />)

    expect(screen.getByText('settings.messages.wide_mode')).toBeInTheDocument()
    expect(screen.getByText('message.message.multi_model_style.label')).toBeInTheDocument()
    expect(screen.getByText('settings.messages.show_message_outline')).toBeInTheDocument()
    expect(screen.getByText('chat.settings.code_fancy_block.label')).toBeInTheDocument()
    expect(screen.getByText('settings.math.single_dollar.label')).toBeInTheDocument()
    // message-behavior settings (navigation, delete confirm) live with the message section
    expect(screen.getByText('settings.messages.navigation.label')).toBeInTheDocument()
    expect(screen.getByText('settings.messages.input.confirm_delete_message')).toBeInTheDocument()
    // input/editor controls live in the general variant only
    expect(screen.queryByText('settings.messages.input.show_estimated_tokens')).toBeNull()
  })

  it('renders input/editor and code-tool settings in the general variant', () => {
    render(<ChatPreferenceSections variant="general" />)

    expect(screen.getByText('settings.messages.input.show_estimated_tokens')).toBeInTheDocument()
    expect(screen.getByText('settings.messages.input.send_shortcuts')).toBeInTheDocument()
    expect(screen.getByText('chat.settings.code_editor.title')).toBeInTheDocument()
    expect(screen.getByText('chat.settings.code_execution.title')).toBeInTheDocument()
    // message-behavior + display controls are absent
    expect(screen.queryByText('settings.messages.navigation.label')).toBeNull()
    expect(screen.queryByText('settings.messages.wide_mode')).toBeNull()
  })

  it('renders wide layout mode off by default and enables it by disabling narrow mode', () => {
    render(<ChatPreferenceSections variant="display" />)

    const wideModeSwitch = screen.getByRole('button', { name: 'settings.messages.wide_mode' })
    expect(wideModeSwitch).toHaveAttribute('data-checked', 'false')

    fireEvent.click(wideModeSwitch)

    expect(mocks.setPreference).toHaveBeenCalledWith('chat.narrow_mode', false)
  })

  it('renders the section headings for each variant', () => {
    const { unmount } = render(<ChatPreferenceSections variant="general" />)
    expect(screen.getByText('chat.settings.input_editor.title')).toBeInTheDocument()
    expect(screen.getByText('chat.settings.code_tools.title')).toBeInTheDocument()
    unmount()

    render(<ChatPreferenceSections variant="display" />)
    expect(screen.getByText('settings.messages.title')).toBeInTheDocument()
    expect(screen.getByText('chat.settings.code.title')).toBeInTheDocument()
  })
})
