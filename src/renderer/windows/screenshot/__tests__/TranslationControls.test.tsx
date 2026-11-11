import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranslateLanguage } from '@shared/data/types/translate'

import { TranslationControls } from '../components/TranslationControls'
import type { ScreenshotTranslation } from '../hooks/useScreenshotTranslation'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))
vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    languages: [
      { langCode: 'en-us', value: 'English', emoji: '🇺🇸' },
      { langCode: 'zh-cn', value: '中文', emoji: '🇨🇳' }
    ],
    getLabel: (language: TranslateLanguage) => language.value
  })
}))

function createTranslation(overrides: Partial<ScreenshotTranslation> = {}): ScreenshotTranslation {
  return {
    workState: 'idle',
    view: 'original',
    blocks: [],
    sourceLangCode: null,
    counts: { total: 0, translated: 0, failed: 0, skipped: 0 },
    modelId: null,
    modelStatus: 'missing',
    modelPersistError: false,
    targetLangCode: 'en-us',
    errorMessage: null,
    start: vi.fn(),
    clear: vi.fn(),
    retry: vi.fn(),
    setView: vi.fn(),
    selectModel: vi.fn().mockResolvedValue(undefined),
    setTargetLanguage: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})
afterEach(cleanup)

describe('TranslationControls', () => {
  // Catches an unnamed control or a disconnected start/view/clear action.
  it('names its controls and starts, compares and clears translation', async () => {
    const user = userEvent.setup()
    const translation = createTranslation()
    render(<TranslationControls translation={translation} disabled={false} />)
    const trigger = screen.getByRole('button', { name: 'Translate' })
    expect(trigger).toHaveAttribute('aria-pressed', 'false')
    await user.click(trigger)
    expect(translation.start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('combobox', { name: 'Target Language' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select translation model' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Select a chat model to translate.')
    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Translated' }))
    expect(translation.setView).toHaveBeenCalledWith('translated')
    await user.click(screen.getByRole('button', { name: 'Clear translation' }))
    expect(translation.clear).toHaveBeenCalledTimes(1)
  })

  // Catches a lost target-language update through the existing real selector.
  it('sends a selected target language to the translation hook', async () => {
    const user = userEvent.setup()
    const translation = createTranslation()
    render(<TranslationControls translation={translation} disabled={false} />)
    await user.click(screen.getByRole('button', { name: 'Translate' }))
    const target = screen.getByRole('combobox', { name: 'Target Language' })
    await user.click(target)
    await user.clear(target)
    await user.type(target, 'zh-cn{Enter}')
    expect(translation.setTargetLanguage).toHaveBeenCalledWith('zh-cn')
  })

  // Catches hidden failures, wrong block retry, duplicate dispatch and silent persistence failure.
  it('explains failures and skips and retries only the requested failed block once', async () => {
    const user = userEvent.setup()
    const translation = createTranslation({
      workState: 'partial-failure',
      view: 'translated',
      modelPersistError: true,
      counts: { total: 4, translated: 1, failed: 2, skipped: 1 },
      blocks: ['cannot_fit', 'no_background'].map((reason, index) => ({
        id: 8 + index,
        sourceText: `Source line ${index}`,
        originalBox: { x: 0, y: 0, width: 40, height: 20 },
        box: null,
        detectedLanguage: 'en-us',
        status: 'failed',
        reason
      }))
    })
    render(<TranslationControls translation={translation} disabled={false} />)
    const trigger = screen.getByRole('button', { name: 'Translate' })
    expect(trigger).toHaveAttribute('aria-pressed', 'true')
    await user.click(trigger)
    expect(translation.start).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('1 translated; 2 failed')
    expect(screen.getByRole('status')).toHaveTextContent('1 text blocks left unchanged')
    expect(screen.getByRole('status')).toHaveTextContent('This model is selected, but could not be remembered.')
    expect(screen.getByText('Source line 0')).toBeInTheDocument()
    expect(screen.getByText('Source line 1')).toBeInTheDocument()
    expect(screen.getByText('The translated text does not fit.')).toBeInTheDocument()
    expect(screen.getByText('No usable background could be sampled.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Translated' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    expect(translation.retry).toHaveBeenCalledExactlyOnceWith(8)
  })

  // Catches annotation exclusion being lost at the actual trigger.
  it('disables translation while annotating and exposes the reason', async () => {
    const user = userEvent.setup()
    const translation = createTranslation()
    render(
      <TranslationControls
        translation={translation}
        disabled
        disabledReason="Translation is unavailable while annotating"
      />
    )
    const trigger = screen.getByRole('button', { name: 'Translate' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('title', 'Translation is unavailable while annotating')
    await user.click(trigger)
    expect(translation.start).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
