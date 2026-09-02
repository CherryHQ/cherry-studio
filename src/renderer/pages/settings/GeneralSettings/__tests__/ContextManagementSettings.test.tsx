import '@testing-library/jest-dom/vitest'

import { MIN_TRUNCATE_THRESHOLD } from '@shared/data/types/contextSettings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prefs = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  setters: {} as Record<string, ReturnType<typeof vi.fn>>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    prefs.setters[key] ??= vi.fn()
    return [prefs.state[key], prefs.setters[key]]
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Divider: () => <hr />,
  EditableNumber: ({
    value,
    onChange,
    ...props
  }: {
    value: number | null
    onChange: (value: number | null) => void
    'aria-label'?: string
    placeholder?: string
  }) => (
    <input
      aria-label={props['aria-label']}
      placeholder={props.placeholder}
      defaultValue={value ?? ''}
      onBlur={(event) => {
        const raw = event.currentTarget.value
        onChange(raw === '' ? null : Number(raw))
      }}
    />
  ),
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      role="switch"
      checked={!!checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
  InfoTooltip: ({ content, ariaLabel }: { content: string; ariaLabel: string }) => (
    <span aria-label={ariaLabel} data-tooltip-content={content} />
  )
}))

vi.mock('@renderer/hooks/useModel', () => ({ useModelById: () => ({ model: undefined }) }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/components/DefaultModelSelector', () => ({
  DefaultModelSelector: () => <div data-testid="compress-model-selector" />
}))

import { ContextManagementSettings } from '../ContextManagementSettings'

describe('ContextManagementSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prefs.state = {
      'chat.context_settings.enabled': true,
      'chat.context_settings.max_messages': null,
      'chat.context_settings.truncate_threshold': 50_000,
      'chat.context_settings.compress.enabled': true,
      'chat.context_settings.compress.model_id': null
    }
  })

  it('collapses the offload settings when context management is off, keeping the scope control', () => {
    prefs.state['chat.context_settings.enabled'] = false
    render(<ContextManagementSettings />)
    expect(screen.getByText('settings.models.context_management.scope_description')).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(screen.queryByLabelText('settings.models.context_management.truncate_threshold')).not.toBeInTheDocument()
    expect(screen.queryByTestId('compress-model-selector')).not.toBeInTheDocument()
    // Scope is not governed by the master switch, so it stays reachable.
    expect(screen.getByLabelText('settings.models.context_management.max_messages')).toBeInTheDocument()
  })

  it('writes the message limit and clears it back to unlimited', () => {
    render(<ContextManagementSettings />)
    const input = screen.getByLabelText('settings.models.context_management.max_messages')
    expect(input).toHaveAttribute('placeholder', 'settings.models.context_management.max_messages_unlimited')

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(prefs.setters['chat.context_settings.max_messages']).toHaveBeenCalledWith(5)

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(prefs.setters['chat.context_settings.max_messages']).toHaveBeenCalledWith(null)
  })

  it('shows item descriptions in tooltips instead of inline', () => {
    render(<ContextManagementSettings />)

    const items = [
      ['max_messages', 'max_messages_description'],
      ['enabled', 'enabled_description'],
      ['truncate_threshold', 'truncate_threshold_description'],
      ['compress_enabled', 'compress_enabled_description']
    ]

    for (const [title, description] of items) {
      const titleKey = `settings.models.context_management.${title}`
      const descriptionKey = `settings.models.context_management.${description}`
      const trigger = screen.getByLabelText(`${titleKey}: ${descriptionKey}`)
      expect(trigger).toHaveAttribute('data-tooltip-content', descriptionKey)
      expect(screen.queryByText(descriptionKey)).not.toBeInTheDocument()
    }
  })

  it('writes the master switch preference', () => {
    prefs.state['chat.context_settings.enabled'] = false
    render(<ContextManagementSettings />)
    fireEvent.click(screen.getByRole('switch'))
    expect(prefs.setters['chat.context_settings.enabled']).toHaveBeenCalledWith(true)
  })

  it('floors the threshold and clamps it to the fs_read-safe minimum', () => {
    render(<ContextManagementSettings />)
    const input = screen.getByLabelText('settings.models.context_management.truncate_threshold')
    const setter = prefs.setters['chat.context_settings.truncate_threshold']

    fireEvent.change(input, { target: { value: '80000.7' } })
    fireEvent.blur(input)
    expect(setter).toHaveBeenLastCalledWith(80_000)

    // Not ignored — clamped. The value doubles as fs_read's per-call output cap,
    // so anything below the floor makes persisted output permanently unreadable.
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)
    expect(setter).toHaveBeenLastCalledWith(MIN_TRUNCATE_THRESHOLD)

    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.blur(input)
    expect(setter).toHaveBeenLastCalledWith(MIN_TRUNCATE_THRESHOLD)
  })

  it('shows the compress model selector only while compression is on', () => {
    const { rerender } = render(<ContextManagementSettings />)
    expect(screen.getByTestId('compress-model-selector')).toBeInTheDocument()

    prefs.state['chat.context_settings.compress.enabled'] = false
    rerender(<ContextManagementSettings />)
    expect(screen.queryByTestId('compress-model-selector')).not.toBeInTheDocument()
  })
})
