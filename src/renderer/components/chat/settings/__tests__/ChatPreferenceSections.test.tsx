import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import ChatPreferenceSections from '../ChatPreferenceSections'

const mocks = vi.hoisted(() => ({
  loadThemeNames: vi.fn(async () => ['auto', 'github']),
  loadCmThemeNames: vi.fn(async () => ['auto', 'githubDark']),
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
    'chat.message.keep_intermediate_text': false,
    'chat.message.show_citation_markers': true,
    'chat.message.user_content.default_expanded': false,
    'chat.message.multi_model.style': 'horizontal',
    'chat.message.math.single_dollar': true,
    'chat.input.show_estimated_tokens': false,
    'chat.input.paste_long_text_as_file': false,
    'chat.input.paste_long_text_threshold': 1500,
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
  useCodeStyleThemeCatalog: () => ({
    loadThemeNames: mocks.loadThemeNames,
    themeNames: ['auto', 'github'],
    loadCmThemeNames: mocks.loadCmThemeNames,
    cmThemeNames: ['auto', 'githubDark']
  })
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const { InputNumber } = await importOriginal<typeof CherryStudioUi>()

  return {
    CustomTag: ({ children }: PropsWithChildren) => <span>{children}</span>,
    Divider: ({ className }: { className?: string }) => <hr className={className} />,
    InputNumber,
    Flex: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
      <div className={className}>{children}</div>
    ),
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
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('ChatPreferenceSections', () => {
  beforeEach(() => {
    mocks.preferenceValues['chat.message.font_size'] = 14
    mocks.preferenceValues['chat.narrow_mode'] = true
    mocks.preferenceValues['chat.message.user_content.default_expanded'] = false
    mocks.preferenceValues['chat.input.paste_long_text_as_file'] = false
    mocks.preferenceValues['chat.input.paste_long_text_threshold'] = 1500
    mocks.preferenceValues['chat.message.keep_intermediate_text'] = false
    mocks.loadThemeNames.mockClear()
    mocks.setPreference.mockClear()
  })

  it('binds the citation marker switch to its preference and preserves its default', () => {
    mocks.preferenceValues['chat.message.show_citation_markers'] = true
    render(<ChatPreferenceSections />)
    const toggle = screen.getByRole('button', { name: 'settings.messages.show_citation_markers.label' })
    expect(toggle).toHaveAttribute('data-checked', 'true')
    fireEvent.click(toggle)
    expect(mocks.setPreference).toHaveBeenCalledWith('chat.message.show_citation_markers', false)
  })

  it('labels the auto code themes as the Cherry default while keeping the stored value', () => {
    render(<ChatPreferenceSections />)

    const autoItems = screen.getAllByText('chat.settings.code_theme.cherry_default')
    expect(autoItems.map((item) => item.getAttribute('data-value'))).toEqual(['auto', 'auto'])
    expect(screen.queryByText('auto')).toBeNull()
  })

  it('hides the long paste threshold until the paste-as-file toggle is enabled', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ChatPreferenceSections />)

    const toggle = screen.getByRole('button', { name: 'settings.messages.input.paste_long_text_as_file' })
    expect(toggle).toHaveAttribute('data-checked', 'false')
    expect(screen.queryByText('settings.messages.input.paste_long_text_threshold')).toBeNull()

    await user.click(toggle)

    expect(mocks.setPreference).toHaveBeenCalledWith('chat.input.paste_long_text_as_file', true)
    rerender(<ChatPreferenceSections />)

    expect(
      screen.getByRole('spinbutton', {
        name: 'settings.messages.input.paste_long_text_threshold'
      })
    ).toBeInTheDocument()
  })

  it('saves default user-message expansion independently from thinking auto-collapse', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ChatPreferenceSections />)
    const name = 'settings.messages.user_content.default_expanded.label'
    expect(screen.getByRole('button', { name })).toHaveAttribute('data-checked', 'false')

    await user.click(screen.getByRole('button', { name }))
    expect(mocks.setPreference).toHaveBeenCalledWith('chat.message.user_content.default_expanded', true)
    expect(mocks.preferenceValues['chat.message.thought.auto_collapse']).toBe(true)
    rerender(<ChatPreferenceSections />)
    expect(screen.getByRole('button', { name })).toHaveAttribute('data-checked', 'true')

    await user.click(screen.getByRole('button', { name }))
    expect(mocks.setPreference).toHaveBeenCalledWith('chat.message.user_content.default_expanded', false)
  })

  it('lets the user update the long paste threshold through the real number field', async () => {
    const user = userEvent.setup()
    mocks.preferenceValues['chat.input.paste_long_text_as_file'] = true
    render(<ChatPreferenceSections />)

    const thresholdInput = screen.getByRole('spinbutton', {
      name: 'settings.messages.input.paste_long_text_threshold'
    })

    await user.clear(thresholdInput)
    await user.type(thresholdInput, '2400')
    await user.tab()

    expect(mocks.setPreference).toHaveBeenCalledWith('chat.input.paste_long_text_threshold', 2400)
  })

  it('renders wide layout mode off by default and enables it by disabling narrow mode', () => {
    render(<ChatPreferenceSections />)

    const wideModeSwitch = screen.getByRole('button', { name: 'settings.messages.wide_mode' })

    fireEvent.click(wideModeSwitch)

    expect(mocks.setPreference).toHaveBeenCalledWith('chat.narrow_mode', false)
  })

  it('lets the user enable intermediate assistant text from message settings', async () => {
    const user = userEvent.setup()
    render(<ChatPreferenceSections />)

    const toggle = screen.getByRole('button', { name: 'settings.messages.keep_intermediate_text.label' })
    expect(toggle).toHaveAttribute('data-checked', 'false')
    await user.click(toggle)

    expect(mocks.setPreference).toHaveBeenCalledWith('chat.message.keep_intermediate_text', true)
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
