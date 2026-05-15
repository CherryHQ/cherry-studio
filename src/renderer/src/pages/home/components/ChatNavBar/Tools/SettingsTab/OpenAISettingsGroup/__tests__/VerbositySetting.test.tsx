import type { Model } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { createContext, use } from 'react'
import { describe, expect, it, vi } from 'vitest'

import VerbositySetting from '../VerbositySetting'

vi.mock('@renderer/config/models', () => ({
  // The current saved verbosity is 'high', but the model only supports
  // [undefined, null, 'medium'] — i.e. 'high' is no longer valid. The W2 fix
  // is that VerbositySetting must derive the displayed value at render and
  // must NOT fire onVerbosityChange just because of this mismatch.
  getModelSupportedVerbosity: () => [undefined, null, 'medium']
}))

vi.mock('@renderer/pages/settings', () => ({
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/pages/chat-settings/settingsPanelPrimitives', () => ({
  SettingRowTitleSmall: ({ children }: PropsWithChildren) => <span>{children}</span>
}))

const SelectContext = createContext<string | undefined>(undefined)

vi.mock('@cherrystudio/ui', () => ({
  Select: ({ children, value }: PropsWithChildren<{ value?: string }>) => (
    <SelectContext value={value}>{children}</SelectContext>
  ),
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children, value }: PropsWithChildren<{ className?: string; value: string }>) => (
    <span data-testid={`option-${value}`}>{children}</span>
  ),
  SelectTrigger: ({ children }: PropsWithChildren) => <button type="button">{children}</button>,
  SelectValue: () => {
    const value = use(SelectContext)
    return <span data-testid="selected-value">{value}</span>
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const model = {
  id: 'gpt-5.1-nano',
  provider: 'openai',
  name: 'gpt-5.1-nano',
  group: ''
} satisfies Model

describe('VerbositySetting', () => {
  it('shows the fallback verbosity for unsupported saved values WITHOUT firing onVerbosityChange', () => {
    const onVerbosityChange = vi.fn()

    render(<VerbositySetting model={model} verbosity="high" onVerbosityChange={onVerbosityChange} />)

    // 'high' is not in the mocked supported list; the displayed value falls
    // back to the highest supported entry ('medium' in mocked options).
    expect(screen.getByTestId('selected-value').textContent).toBe('medium')

    // Critical W2 invariant: the auto-correct is render-derived only, not a
    // useEffect that writes to the store. The store must not be touched
    // until the user actually picks something.
    expect(onVerbosityChange).not.toHaveBeenCalled()
  })

  it('leaves a supported value untouched', () => {
    const onVerbosityChange = vi.fn()

    render(<VerbositySetting model={model} verbosity="medium" onVerbosityChange={onVerbosityChange} />)

    expect(screen.getByTestId('selected-value').textContent).toBe('medium')
    expect(onVerbosityChange).not.toHaveBeenCalled()
  })
})
