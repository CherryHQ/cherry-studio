import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-us' } })
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({ languages: [] }),
  useTranslateLanguages: () => ({
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn()
  })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ConfirmDialog: () => null,
  HelpTooltip: () => null,
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageSidePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) => (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange(!checked)} />
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

import { TranslateSettingsPanelContent } from '../TranslateSettings'

const getPromptTextarea = () => screen.getAllByRole('textbox')[0]

describe('TranslateSettingsPanelContent', () => {
  const setPersisted = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    setPersisted.mockReset()
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_prompt', TRANSLATE_PROMPT)
    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'feature.translate.model_prompt') {
        return [MockUsePreferenceUtils.getPreferenceValue('feature.translate.model_prompt'), setPersisted]
      }
      return [null, vi.fn().mockResolvedValue(undefined)]
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not persist the default prompt when the saved prompt loads after mount', () => {
    const { rerender } = render(<TranslateSettingsPanelContent />)

    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_prompt', 'saved custom prompt')
    rerender(<TranslateSettingsPanelContent />)

    expect(getPromptTextarea()).toHaveValue('saved custom prompt')

    expect(setPersisted).not.toHaveBeenCalled()
  })

  it('debounces user prompt edits before persisting', async () => {
    vi.useFakeTimers()
    render(<TranslateSettingsPanelContent />)

    fireEvent.change(getPromptTextarea(), { target: { value: 'new custom prompt' } })

    await act(async () => vi.advanceTimersByTime(399))
    expect(setPersisted).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(1))
    expect(setPersisted).toHaveBeenCalledWith('new custom prompt')
  })
})
