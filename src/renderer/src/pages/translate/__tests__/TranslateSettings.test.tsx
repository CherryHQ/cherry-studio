import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translateLanguageMutationsMock = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn()
}))

let mockLanguages: Array<{ value: string; langCode: string; emoji: string; createdAt: string; updatedAt: string }> = []

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-us' } })
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({ languages: mockLanguages }),
  useTranslateLanguages: () => translateLanguageMutationsMock
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('../components/LanguagePicker', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <button type="button" data-testid={`language-picker-${value}`} onClick={() => onChange('zh-cn')}>
      {value}
    </button>
  )
}))

vi.mock('../components/IconButton', () => ({
  default: ({ children, ...props }: React.ComponentProps<'button'> & { active?: boolean; size?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
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
  PageSidePanel: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) => (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange(!checked)} />
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

import TranslateSettings, { TranslateSettingsPanelContent } from '../TranslateSettings'

const getPromptTextarea = () => screen.getAllByRole('textbox')[0]

describe('TranslateSettings', () => {
  const setBidirectionalPair = vi.fn().mockResolvedValue(undefined)
  const setAutoDetectionMethod = vi.fn().mockResolvedValue(undefined)
  const setEnableMarkdown = vi.fn().mockResolvedValue(undefined)
  const setAutoCopy = vi.fn().mockResolvedValue(undefined)
  const setScrollSync = vi.fn().mockResolvedValue(undefined)
  const setBidirectionalEnabled = vi.fn().mockResolvedValue(undefined)
  const setModelPrompt = vi.fn().mockResolvedValue(undefined)
  const fallbackSetter = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockLanguages = []

    setBidirectionalPair.mockReset()
    setAutoDetectionMethod.mockReset()
    setEnableMarkdown.mockReset()
    setAutoCopy.mockReset()
    setScrollSync.mockReset()
    setBidirectionalEnabled.mockReset()
    setModelPrompt.mockReset()
    fallbackSetter.mockReset()

    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.bidirectional_pair': ['en-us', 'zh-cn'],
      'feature.translate.page.enable_markdown': false,
      'feature.translate.page.auto_copy': false,
      'feature.translate.auto_detection_method': 'auto',
      'feature.translate.page.scroll_sync': false,
      'feature.translate.page.bidirectional_enabled': true,
      'feature.translate.model_prompt': TRANSLATE_PROMPT
    })

    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'feature.translate.page.bidirectional_pair') {
        return [MockUsePreferenceUtils.getPreferenceValue(key as any), setBidirectionalPair]
      }
      if (key === 'feature.translate.auto_detection_method') {
        return [MockUsePreferenceUtils.getPreferenceValue(key as any), setAutoDetectionMethod]
      }
      if (key === 'feature.translate.page.enable_markdown') {
        return [MockUsePreferenceUtils.getPreferenceValue(key as any), setEnableMarkdown]
      }
      if (key === 'feature.translate.page.auto_copy') {
        return [MockUsePreferenceUtils.getPreferenceValue(key as any), setAutoCopy]
      }
      if (key === 'feature.translate.page.scroll_sync') {
        return [MockUsePreferenceUtils.getPreferenceValue(key as any), setScrollSync]
      }
      if (key === 'feature.translate.page.bidirectional_enabled') {
        return [MockUsePreferenceUtils.getPreferenceValue(key as any), setBidirectionalEnabled]
      }
      if (key === 'feature.translate.model_prompt') {
        return [MockUsePreferenceUtils.getPreferenceValue(key as any), setModelPrompt]
      }
      return [MockUsePreferenceUtils.getPreferenceValue(key as any), fallbackSetter]
    })

    ;(window as any).toast = {
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      success: vi.fn()
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('warns and blocks pair persistence when selecting the same bidirectional language', () => {
    render(<TranslateSettings visible onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId('language-picker-en-us'))

    expect((window as any).toast.warning).toHaveBeenCalledWith('translate.language.same')
    expect(setBidirectionalPair).not.toHaveBeenCalled()
  })

  it('persists selected auto detection method', async () => {
    render(<TranslateSettings visible onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('translate.detect.method.llm.label'))

    await waitFor(() => expect(setAutoDetectionMethod).toHaveBeenCalledWith('llm'))
  })
})

describe('TranslateSettingsPanelContent', () => {
  const setPersisted = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockLanguages = []

    setPersisted.mockReset()
    translateLanguageMutationsMock.add.mockReset()
    translateLanguageMutationsMock.add.mockResolvedValue(undefined)
    translateLanguageMutationsMock.update.mockReset()
    translateLanguageMutationsMock.remove.mockReset()

    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_prompt', TRANSLATE_PROMPT)
    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'feature.translate.model_prompt') {
        return [MockUsePreferenceUtils.getPreferenceValue('feature.translate.model_prompt'), setPersisted]
      }
      return [MockUsePreferenceUtils.getPreferenceValue(key as any), vi.fn().mockResolvedValue(undefined)]
    })

    ;(window as any).toast = {
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      success: vi.fn()
    }
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

  it('shows validation error and skips add when custom language name is empty', () => {
    render(<TranslateSettingsPanelContent />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add common.language' }))
    fireEvent.change(screen.getByPlaceholderText('settings.translate.custom.langCode.placeholder'), {
      target: { value: 'x-test' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))

    expect((window as any).toast.error).toHaveBeenCalledWith('settings.translate.custom.error.value.empty')
    expect(translateLanguageMutationsMock.add).not.toHaveBeenCalled()
  })

  it('shows validation error and skips add when custom language code is invalid', () => {
    render(<TranslateSettingsPanelContent />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add common.language' }))
    fireEvent.change(screen.getByPlaceholderText('settings.translate.custom.value.placeholder'), {
      target: { value: 'Klingon' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.translate.custom.langCode.placeholder'), {
      target: { value: 'invalid_code' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))

    expect((window as any).toast.error).toHaveBeenCalledWith('settings.translate.custom.error.langCode.invalid')
    expect(translateLanguageMutationsMock.add).not.toHaveBeenCalled()
  })

  it('submits normalized custom language payload when inputs are valid', async () => {
    render(<TranslateSettingsPanelContent />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add common.language' }))
    fireEvent.change(screen.getByPlaceholderText('settings.translate.custom.value.placeholder'), {
      target: { value: ' Klingon ' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.translate.custom.langCode.placeholder'), {
      target: { value: 'XK-LA' }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    })

    await waitFor(() =>
      expect(translateLanguageMutationsMock.add).toHaveBeenCalledWith({
        value: 'Klingon',
        langCode: 'xk-la',
        emoji: '🌐'
      })
    )
  })
})
