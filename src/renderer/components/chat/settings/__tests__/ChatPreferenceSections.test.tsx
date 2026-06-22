import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    'chat.message.show_prompt': true,
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

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
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
  Slider: ({ value }: { value: number[] }) => <div data-testid="slider" data-value={value.join(',')} />,
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
    mocks.preferenceValues['chat.message.font_size'] = 14
    mocks.preferenceValues['chat.narrow_mode'] = true
    mocks.setPreference.mockClear()
  })

  it('renders chat preferences', () => {
    render(<ChatPreferenceSections />)

    expect(screen.getByText('settings.messages.use_serif_font')).toBeInTheDocument()
    expect(screen.getByText('settings.messages.wide_mode')).toBeInTheDocument()
    expect(screen.queryByText('settings.math.engine.label')).toBeNull()
    expect(screen.getByText('settings.math.single_dollar.label')).toBeInTheDocument()
    expect(screen.getByText('chat.settings.code_fancy_block.label')).toBeInTheDocument()
    expect(screen.getByText('settings.messages.prompt')).toBeInTheDocument()
    expect(screen.getByText('settings.messages.show_message_outline')).toBeInTheDocument()
    expect(screen.getByText('message.message.multi_model_style.label')).toBeInTheDocument()
    expect(screen.getByText('settings.messages.input.show_estimated_tokens')).toBeInTheDocument()
    expect(screen.queryByText('settings.messages.input.enable_quick_triggers')).toBeNull()
  })

  it('does not render input translation controls', () => {
    mocks.preferenceValues['app.language'] = 'zh-cn'

    render(<ChatPreferenceSections />)

    expect(screen.queryByText('settings.input.auto_translate_with_space')).toBeNull()
    expect(screen.queryByText('settings.input.show_translate_confirm')).toBeNull()
    expect(screen.queryByText('settings.input.target_language.label')).toBeNull()
  })

  it('renders wide layout mode off by default and enables it by disabling narrow mode', () => {
    render(<ChatPreferenceSections />)

    const wideModeSwitch = screen.getByRole('button', { name: 'settings.messages.wide_mode' })
    expect(wideModeSwitch).toHaveAttribute('data-checked', 'false')

    fireEvent.click(wideModeSwitch)

    expect(mocks.setPreference).toHaveBeenCalledWith('chat.narrow_mode', false)
  })

  it('renders preference groups without collapsible controls', () => {
    render(<ChatPreferenceSections />)

    for (const heading of [
      'settings.messages.input.title',
      'settings.messages.title',
      'settings.math.title',
      'chat.settings.code.title'
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument()
    }

    expect(
      screen
        .getByText('settings.messages.input.title')
        .compareDocumentPosition(screen.getByText('settings.messages.title')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'settings.messages.title' })).toBeNull()
  })

  it('syncs the font-size slider draft when the preference changes externally', async () => {
    const { rerender } = render(<ChatPreferenceSections />)

    expect(screen.getByTestId('slider')).toHaveAttribute('data-value', '14')

    mocks.preferenceValues['chat.message.font_size'] = 18
    rerender(<ChatPreferenceSections />)

    await waitFor(() => {
      expect(screen.getByTestId('slider')).toHaveAttribute('data-value', '18')
    })
  })
})
