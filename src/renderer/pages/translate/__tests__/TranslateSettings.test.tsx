import { toast } from '@renderer/services/toast'
import { TRANSLATE_PROMPT } from '@shared/ai/prompts'
import { parsePersistedLangCode } from '@shared/data/preference/preferenceTypes'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translateLanguageMutationsMock = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn()
}))

let mockLanguages: TranslateLanguage[] = []
let mockTranslateModel: Model | undefined

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: mockTranslateModel })
}))

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

vi.mock('@renderer/utils/style', () => ({
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
  ConfirmDialog: ({ onConfirm, title }: { onConfirm?: () => void | Promise<void>; title?: string }) => (
    <button type="button" data-testid={`confirm-${title ?? 'unknown'}`} onClick={() => void onConfirm?.()}>
      {title}
    </button>
  ),
  Field: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FieldDescription: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
  FieldLabel: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label>,
  HelpTooltip: () => null,
  Input: ({ ...props }: React.ComponentProps<'input'>) => <input {...props} />,
  InputGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  InputGroupAddon: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  InputGroupButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  InputGroupInput: ({ ...props }: React.ComponentProps<'input'>) => <input {...props} />,
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageSidePanel: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  PageSidePanelItem: ({
    title,
    description,
    action,
    children
  }: {
    title: React.ReactNode
    description?: React.ReactNode
    action?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <div>
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action}
      {children}
    </div>
  ),
  PageSidePanelSection: ({
    title,
    actions,
    children
  }: {
    title: React.ReactNode
    actions?: React.ReactNode
    children: React.ReactNode
  }) => (
    <section>
      <div>{title}</div>
      {actions}
      {children}
    </section>
  ),
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SegmentedControl: <TValue extends string>({
    options,
    onValueChange
  }: {
    options: { value: TValue; label: React.ReactNode }[]
    onValueChange?: (value: TValue) => void
  }) => (
    <div role="radiogroup">
      {options.map((opt) => (
        <button key={opt.value} type="button" onClick={() => onValueChange?.(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  ),
  RadioGroup: ({ children }: { children: React.ReactNode }) => <div role="radiogroup">{children}</div>,
  RadioGroupItem: ({ value }: { value: string }) => <button type="button" role="radio" data-value={value} />,
  EditableNumber: ({ value, onChange }: { value: number; onChange: (value: number) => void }) => (
    <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
  ),
  Slider: ({
    value,
    max,
    onValueChange,
    onValueCommit,
    getThumbAriaLabel,
    ...props
  }: {
    value: number[]
    max: number
    onValueChange?: (value: number[]) => void
    onValueCommit?: (value: number[]) => void
    getThumbAriaLabel?: (index: number) => string
    'aria-label'?: string
  }) => (
    <div role="slider" aria-label={props['aria-label'] ?? getThumbAriaLabel?.(0)} data-value={value[0]}>
      <button type="button" data-testid="slider-drag" onClick={() => onValueChange?.([max])} />
      <button type="button" data-testid="slider-commit" onClick={() => onValueCommit?.([max])} />
    </div>
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean
    onCheckedChange: (value: boolean) => void
    'aria-label'?: string
  }) => (
    <button
      type="button"
      aria-label={props['aria-label']}
      aria-pressed={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

import TranslateSettings, { TranslateSettingsPanelContent } from '../TranslateSettings'

const getPromptTextarea = () => screen.getAllByRole('textbox')[0]
const getAddLanguageButton = () => screen.getByRole('button', { name: 'common.add common.language' })
const openAddLanguageForm = () => {
  fireEvent.click(getAddLanguageButton())
}

const submitCustomLanguage = ({ value, langCode }: { value?: string; langCode?: string }) => {
  openAddLanguageForm()
  if (value !== undefined) {
    fireEvent.change(screen.getByPlaceholderText('settings.translate.custom.value.placeholder'), {
      target: { value }
    })
  }
  if (langCode !== undefined) {
    fireEvent.change(screen.getByPlaceholderText('settings.translate.custom.langCode.placeholder'), {
      target: { value: langCode }
    })
  }
  fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
}

const setBasePreferenceMocks = () => {
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'feature.translate.page.bidirectional_pair': ['en-us', 'zh-cn'],
    'feature.translate.page.enable_markdown': false,
    'feature.translate.page.auto_copy': false,
    'feature.translate.auto_detection_method': 'auto',
    'feature.translate.page.scroll_sync': false,
    'feature.translate.page.bidirectional_enabled': true,
    'feature.translate.model_prompt': TRANSLATE_PROMPT
  })
}

const createCustomLanguage = (langCode: string, value: string, emoji = '🌐'): TranslateLanguage => ({
  value,
  langCode: parsePersistedLangCode(langCode),
  emoji,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

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

    setBasePreferenceMocks()

    const settersByPreference = new Map<string, typeof fallbackSetter>([
      ['feature.translate.page.bidirectional_pair', setBidirectionalPair],
      ['feature.translate.auto_detection_method', setAutoDetectionMethod],
      ['feature.translate.page.enable_markdown', setEnableMarkdown],
      ['feature.translate.page.auto_copy', setAutoCopy],
      ['feature.translate.page.scroll_sync', setScrollSync],
      ['feature.translate.page.bidirectional_enabled', setBidirectionalEnabled],
      ['feature.translate.model_prompt', setModelPrompt]
    ])
    mockUsePreference.mockImplementation((key: string) => {
      return [MockUsePreferenceUtils.getPreferenceValue(key as any), settersByPreference.get(key) ?? fallbackSetter]
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('warns and blocks pair persistence when selecting the same bidirectional language', () => {
    render(<TranslateSettings visible onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId('language-picker-en-us'))

    expect(toast.warning).toHaveBeenCalledWith('translate.language.same')
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
    translateLanguageMutationsMock.update.mockResolvedValue(undefined)
    translateLanguageMutationsMock.remove.mockReset()
    translateLanguageMutationsMock.remove.mockResolvedValue(undefined)

    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_prompt', TRANSLATE_PROMPT)
    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'feature.translate.model_prompt') {
        return [MockUsePreferenceUtils.getPreferenceValue('feature.translate.model_prompt'), setPersisted]
      }
      return [MockUsePreferenceUtils.getPreferenceValue(key as any), vi.fn().mockResolvedValue(undefined)]
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

  it('preserves in-progress edit when a remote prompt value arrives mid-edit', () => {
    vi.useFakeTimers()
    const { rerender } = render(<TranslateSettingsPanelContent />)

    fireEvent.change(getPromptTextarea(), { target: { value: 'user typing' } })
    expect(getPromptTextarea()).toHaveValue('user typing')

    // Remote update arrives before the 400ms debounce fires; the in-progress edit must win.
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_prompt', 'external update')
    rerender(<TranslateSettingsPanelContent />)

    expect(getPromptTextarea()).toHaveValue('user typing')
    expect(setPersisted).not.toHaveBeenCalled()
  })

  it('flushes pending prompt edit on unmount even if the debounce timer has not fired', () => {
    vi.useFakeTimers()
    const { unmount } = render(<TranslateSettingsPanelContent />)

    fireEvent.change(getPromptTextarea(), { target: { value: 'pending value' } })
    expect(setPersisted).not.toHaveBeenCalled()

    unmount()

    expect(setPersisted).toHaveBeenCalledTimes(1)
    expect(setPersisted).toHaveBeenCalledWith('pending value')
  })

  it('shows validation error and skips add when custom language name is empty', () => {
    render(<TranslateSettingsPanelContent />)

    submitCustomLanguage({ langCode: 'x-test' })

    expect(screen.getByText('settings.translate.custom.error.value.empty')).toBeInTheDocument()
    expect(translateLanguageMutationsMock.add).not.toHaveBeenCalled()
  })

  it('shows validation error and skips add when custom language code is empty', () => {
    render(<TranslateSettingsPanelContent />)

    submitCustomLanguage({ value: 'Klingon' })

    expect(screen.getByText('settings.translate.custom.error.langCode.empty')).toBeInTheDocument()
    expect(translateLanguageMutationsMock.add).not.toHaveBeenCalled()
  })

  it('shows validation error and skips add when custom language code is invalid', () => {
    render(<TranslateSettingsPanelContent />)

    submitCustomLanguage({ value: 'Klingon', langCode: 'invalid_code' })

    expect(screen.getByText('settings.translate.custom.error.langCode.invalid')).toBeInTheDocument()
    expect(translateLanguageMutationsMock.add).not.toHaveBeenCalled()
  })

  it('shows validation error and skips add when custom language code conflicts with builtin language', () => {
    render(<TranslateSettingsPanelContent />)

    submitCustomLanguage({ value: 'English Variant', langCode: 'en-us' })

    expect(screen.getByText('settings.translate.custom.error.langCode.builtin')).toBeInTheDocument()
    expect(translateLanguageMutationsMock.add).not.toHaveBeenCalled()
  })

  it('shows validation error and skips add when custom language code already exists', () => {
    mockLanguages = [createCustomLanguage('xk-la', 'Klingon')]
    render(<TranslateSettingsPanelContent />)

    submitCustomLanguage({ value: 'Klingon Alt', langCode: 'xk-la' })

    expect(screen.getByText('settings.translate.custom.error.langCode.exists')).toBeInTheDocument()
    expect(translateLanguageMutationsMock.add).not.toHaveBeenCalled()
  })

  it('submits normalized custom language payload when inputs are valid', async () => {
    render(<TranslateSettingsPanelContent />)

    submitCustomLanguage({ value: ' Klingon ', langCode: 'XK-LA' })

    await waitFor(() =>
      expect(translateLanguageMutationsMock.add).toHaveBeenCalledWith({
        value: 'Klingon',
        langCode: 'xk-la',
        emoji: '🌐'
      })
    )
  })

  it('updates custom language row and keeps normalized payload', async () => {
    mockLanguages = [createCustomLanguage('xk-la', 'Klingon', '🖖')]
    render(<TranslateSettingsPanelContent />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const textboxes = screen.getAllByRole('textbox')
    fireEvent.change(textboxes[1], { target: { value: ' Klingon Prime ' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    })

    await waitFor(() => expect(translateLanguageMutationsMock.update).toHaveBeenCalledWith('xk-la', expect.any(Object)))
    expect(translateLanguageMutationsMock.update).toHaveBeenCalledWith('xk-la', {
      value: 'Klingon Prime',
      emoji: '🖖'
    })
  })

  it('cancels custom language editing without calling update', () => {
    mockLanguages = [createCustomLanguage('xk-la', 'Klingon', '🖖')]
    render(<TranslateSettingsPanelContent />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(translateLanguageMutationsMock.update).not.toHaveBeenCalled()
  })

  it('deletes custom language after confirm', async () => {
    mockLanguages = [createCustomLanguage('xk-la', 'Klingon', '🖖')]
    render(<TranslateSettingsPanelContent />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-settings.translate.custom.delete.title'))
    })

    await waitFor(() => expect(translateLanguageMutationsMock.remove).toHaveBeenCalledWith('xk-la'))
  })
})

describe('translate model parameters', () => {
  const reasoningModel = {
    id: 'openai::gpt-5',
    providerId: 'openai',
    apiModelId: 'gpt-5',
    name: 'GPT-5',
    capabilities: [MODEL_CAPABILITY.REASONING],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    reasoning: {
      controls: [{ kind: 'effort', values: ['low', 'medium', 'high'], default: 'medium' }],
      defaultEffort: 'medium',
      selectableEfforts: ['low', 'medium', 'high']
    }
  } satisfies Model

  const plainModel = {
    id: 'openai::gpt-4.1',
    providerId: 'openai',
    apiModelId: 'gpt-4.1',
    name: 'GPT-4.1',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } satisfies Model

  const setters = new Map<string, ReturnType<typeof vi.fn>>()
  const setterFor = (key: string) => {
    const existing = setters.get(key)
    if (existing) return existing
    const setter = vi.fn().mockResolvedValue(undefined)
    setters.set(key, setter)
    return setter
  }

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockLanguages = []
    mockTranslateModel = undefined
    setters.clear()

    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_prompt': TRANSLATE_PROMPT,
      'feature.translate.model_id': 'openai::gpt-5',
      'feature.translate.enable_temperature': false,
      'feature.translate.temperature': 1,
      'feature.translate.enable_top_p': false,
      'feature.translate.top_p': 1,
      'feature.translate.reasoning_effort': 'none'
    })
    mockUsePreference.mockImplementation((key: string) => [
      MockUsePreferenceUtils.getPreferenceValue(key as any),
      setterFor(key)
    ])
  })

  afterEach(() => {
    cleanup()
  })

  it('enables temperature from the panel', async () => {
    render(<TranslateSettingsPanelContent />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.basic.temperature' }))

    await waitFor(() => expect(setterFor('feature.translate.enable_temperature')).toHaveBeenCalledWith(true))
  })

  it('persists a sampling value on release rather than on every drag step', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.enable_temperature', true)
    render(<TranslateSettingsPanelContent />)

    const slider = within(screen.getByRole('slider', { name: 'library.config.basic.temperature' }))
    fireEvent.click(slider.getByTestId('slider-drag'))
    expect(setterFor('feature.translate.temperature')).not.toHaveBeenCalled()

    fireEvent.click(slider.getByTestId('slider-commit'))
    await waitFor(() => expect(setterFor('feature.translate.temperature')).toHaveBeenCalledWith(2))
  })

  it('offers reasoning effort only for a model that declares it', () => {
    mockTranslateModel = plainModel
    const { rerender } = render(<TranslateSettingsPanelContent />)
    expect(screen.queryByText('assistants.settings.reasoning_effort.label')).not.toBeInTheDocument()

    mockTranslateModel = reasoningModel
    rerender(<TranslateSettingsPanelContent />)
    expect(screen.getByText('assistants.settings.reasoning_effort.label')).toBeInTheDocument()
  })

  it('keeps a stored effort the model does not declare instead of rewriting it', async () => {
    // Switching to a narrower model must not cost the user their choice: the control
    // shows provider Default, and Main resolves the stored value per request on its own.
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.reasoning_effort', 'max')
    mockTranslateModel = reasoningModel

    render(<TranslateSettingsPanelContent />)

    await waitFor(() => expect(screen.getByText('assistants.settings.reasoning_effort.label')).toBeInTheDocument())
    expect(setterFor('feature.translate.reasoning_effort')).not.toHaveBeenCalled()
  })

  it('does not touch the stored effort for a model with no reasoning at all', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.reasoning_effort', 'high')
    mockTranslateModel = plainModel

    render(<TranslateSettingsPanelContent />)

    await waitFor(() => expect(screen.getByText('library.config.basic.temperature')).toBeInTheDocument())
    expect(setterFor('feature.translate.reasoning_effort')).not.toHaveBeenCalled()
  })

  it('persists the effort the user picks', async () => {
    mockTranslateModel = reasoningModel
    render(<TranslateSettingsPanelContent />)

    // The effort slider commits on change, unlike the sampling sliders below it.
    fireEvent.click(within(screen.getByRole('slider', { name: 'agent.speed.effort' })).getByTestId('slider-drag'))

    await waitFor(() => expect(setterFor('feature.translate.reasoning_effort')).toHaveBeenCalledWith('high'))
  })
})
