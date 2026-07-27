import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import QuickAssistantSettings from '../QuickAssistantSettings'

const assistantState = vi.hoisted(() => ({
  assistants: [
    { id: 'assistant-1', name: 'Assistant 1' },
    { id: 'assistant-2', name: 'Assistant 2' }
  ],
  hasLoaded: true
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
      React.createElement(tag, props, children)

  return {
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', { type: 'button', ...props }, children),
    Command: passthrough('div'),
    CommandEmpty: passthrough('div'),
    CommandGroup: passthrough('div'),
    CommandInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
    CommandItem: passthrough('div'),
    CommandList: passthrough('div'),
    Divider: passthrough('hr'),
    InfoTooltip: () => null,
    Popover: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
    PopoverContent: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
    PopoverTrigger: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
    RowFlex: passthrough('div'),
    SegmentedControl: ({
      options,
      value,
      onValueChange
    }: {
      options: Array<{ disabled?: boolean; label: string; value: string }>
      value: string
      onValueChange?: (value: string) => void
    }) =>
      React.createElement(
        'div',
        { role: 'radiogroup' },
        options.map((option) =>
          React.createElement(
            'button',
            {
              'aria-checked': value === option.value,
              disabled: option.disabled,
              key: option.value,
              onClick: () => option.value !== value && onValueChange?.(option.value),
              role: 'radio',
              type: 'button'
            },
            option.label
          )
        )
      ),
    Switch: ({ checked }: { checked: boolean }) =>
      React.createElement('input', { checked, readOnly: true, type: 'checkbox' })
  }
})

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({
    assistants: assistantState.assistants,
    hasLoaded: assistantState.hasLoaded
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: undefined })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { info: vi.fn() }
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/windows/quickAssistant/home/HomeWindow', () => ({
  default: () => <div data-testid="quick-assistant-preview" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('QuickAssistantSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)
    assistantState.assistants = [
      { id: 'assistant-1', name: 'Assistant 1' },
      { id: 'assistant-2', name: 'Assistant 2' }
    ]
    assistantState.hasLoaded = true
  })

  it('clears the selected quick assistant after that assistant is deleted', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', 'assistant-1')
    const { rerender } = render(<QuickAssistantSettings />)

    expect(screen.getByRole('radio', { name: 'settings.models.use_assistant' })).toHaveAttribute('aria-checked', 'true')

    assistantState.assistants = [{ id: 'assistant-2', name: 'Assistant 2' }]
    rerender(<QuickAssistantSettings />)

    expect(screen.getByRole('radio', { name: 'settings.models.use_model' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.assistant_id')).toBe('')
    })

    rerender(<QuickAssistantSettings />)
    fireEvent.click(screen.getByRole('radio', { name: 'settings.models.use_assistant' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.assistant_id')).toBe('assistant-2')
    })
  })

  it('keeps a saved assistant selection while the assistant list is still loading', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', 'assistant-1')
    assistantState.assistants = []
    assistantState.hasLoaded = false

    render(<QuickAssistantSettings />)

    expect(screen.getByRole('radio', { name: 'settings.models.use_assistant' })).toHaveAttribute('aria-checked', 'true')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.assistant_id')).toBe('assistant-1')
  })
})
