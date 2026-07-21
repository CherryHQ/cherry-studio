import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { SelectionActionItem, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const english = { langCode: 'en-us', value: 'English', emoji: '🇺🇸' }
  const chinese = { langCode: 'zh-cn', value: 'Chinese', emoji: '🇨🇳' }
  const languages = [chinese, english]

  return {
    english,
    chinese,
    languages,
    getLanguage: vi.fn((langCode: TranslateLangCode) => languages.find((lang) => lang.langCode === langCode) ?? null),
    getLabel: vi.fn((language: TranslateLanguage) => language.value),
    detectLanguage: vi.fn(),
    translate: vi.fn(),
    cancel: vi.fn(),
    scrollToBottom: vi.fn()
  }
})

const i18nMock = vi.hoisted(() => ({
  t: vi.fn((key: string, fallback?: string) => fallback ?? key)
}))

import ActionTranslate from '../ActionTranslate'

const resultContentChunk = vi.hoisted(() => ({ evaluated: vi.fn() }))

vi.mock('../ActionResultContent', () => {
  resultContentChunk.evaluated()
  return { default: () => null }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.language') return ['zh-cn', vi.fn()]
    if (key === 'feature.translate.action.preferred_lang') return ['zh-cn', vi.fn()]
    if (key === 'feature.translate.action.alter_lang') return ['en-us', vi.fn()]
    return [undefined, vi.fn()]
  }
}))

vi.mock('@renderer/hooks/translate', () => ({
  detectLanguageOrUnknown: async (
    text: string,
    detectLanguage: (text: string) => Promise<TranslateLangCode>,
    onError: (error: unknown) => void
  ) => {
    try {
      return await detectLanguage(text)
    } catch (error) {
      onError(error)
      return 'unknown'
    }
  },
  useDetectLang: () => state.detectLanguage,
  useTranslate: () => ({
    translate: state.translate,
    isTranslating: false,
    cancel: state.cancel
  }),
  useLanguages: () => ({
    languages: state.languages as TranslateLanguage[],
    getLanguage: state.getLanguage,
    getLabel: state.getLabel
  })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({ renderConfig: {} })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessagePlatformActions', () => ({
  useMessagePlatformActions: () => ({})
}))

vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: () => <div data-testid="message-content" />
}))

vi.mock('@renderer/components/chat/messages/utils/messageListItem', () => ({
  toMessageListItem: (message: unknown) => message
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => <button type="button">copy</button>
}))

vi.mock('../WindowFooter', () => ({
  default: () => <div data-testid="window-footer" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: i18nMock.t
  })
}))

function createAction(overrides: Partial<SelectionActionItem> = {}): SelectionActionItem {
  return {
    id: 'translate',
    name: 'Translate',
    enabled: true,
    isBuiltIn: true,
    selectedText: 'There is no default export.',
    ...overrides
  }
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ActionTranslate', () => {
  beforeEach(() => {
    state.detectLanguage.mockReset()
    state.getLanguage.mockClear()
    state.getLabel.mockClear()
    state.translate.mockReset()
    state.cancel.mockReset()
    state.scrollToBottom.mockReset()
    state.translate.mockResolvedValue('translated text')
  })

  // MUST run first in this file: the later tests render translation results,
  // which loads the lazy module through React.lazy and permanently marks
  // `resultContentChunk.evaluated` (module caches defeat mockClear). Running
  // before any result has ever rendered is what makes this assertion prove
  // the mount preload specifically.
  it('preloads the result-content chunk on mount, before the response arrives', async () => {
    // Detection never resolves, so the translate flow never produces content —
    // the chunk import must still fire so its download overlaps request latency.
    state.detectLanguage.mockReturnValue(new Promise<never>(() => {}))

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    await waitFor(() => expect(resultContentChunk.evaluated).toHaveBeenCalled())
    expect(state.translate).not.toHaveBeenCalled()
  })

  it('continues translating to the target language when source detection throws', async () => {
    state.detectLanguage.mockRejectedValue(new Error('detect exploded'))

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))
    expect(screen.queryByText('detect exploded')).not.toBeInTheDocument()
  })

  it('shows automatic detection when no concrete source language is available', async () => {
    state.detectLanguage.mockResolvedValueOnce('unknown')

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))
    expect(screen.getByText('translate.detected.language')).toBeInTheDocument()
    expect(screen.queryByText('translate.detected_source')).not.toBeInTheDocument()
  })

  it('keeps the detected language badge after detection resolves while translation is preparing', async () => {
    state.detectLanguage.mockResolvedValue('en-us')
    let resolveTranslate: (value: string) => void = () => {}
    state.translate.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveTranslate = resolve
      })
    )

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))
    expect(screen.queryByText('translate.detecting')).not.toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()

    await act(async () => {
      resolveTranslate('translated text')
    })
  })

  it('localizes known translation errors', async () => {
    state.detectLanguage.mockResolvedValue('unknown')
    state.translate.mockRejectedValue(new Error("Model with id 'provider/model' not found"))

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    expect(await screen.findByText('error.diagnosis.model')).toBeInTheDocument()
    expect(screen.queryByText("Model with id 'provider/model' not found")).not.toBeInTheDocument()
  })

  it('groups auxiliary controls so they wrap together behind the language direction group', async () => {
    state.detectLanguage.mockResolvedValue('en-us')

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))

    const detectedLabel = await screen.findByText('English')
    const detectedBadge = detectedLabel.parentElement as HTMLElement
    const languageDirectionGroup = detectedBadge.parentElement as HTMLElement
    const showOriginalButton = screen.getByRole('button', {
      name: 'selection.action.window.original_show'
    })
    const auxiliaryActionGroup = showOriginalButton.parentElement as HTMLElement
    const toolbar = auxiliaryActionGroup.parentElement as HTMLElement

    expect(toolbar).toHaveClass('flex-wrap')
    expect(toolbar).toContainElement(languageDirectionGroup)
    expect(toolbar).toContainElement(auxiliaryActionGroup)
    expect(languageDirectionGroup).toHaveClass('min-w-0', 'shrink')
    expect(languageDirectionGroup.querySelector('[role="combobox"]')).not.toBeNull()
    expect(auxiliaryActionGroup).toHaveClass('ml-auto', 'shrink-0')
    expect(auxiliaryActionGroup.querySelector('.lucide-settings-2')).not.toBeNull()
    expect(auxiliaryActionGroup.querySelector('.lucide-circle-question-mark')).not.toBeNull()
    expect(auxiliaryActionGroup.querySelector('.lucide-settings-2')?.closest('button')).toHaveClass(
      'text-icon',
      'dark:text-icon'
    )
    expect(auxiliaryActionGroup.querySelector('.lucide-circle-question-mark')).toHaveClass('text-icon')
    expect(detectedBadge).toHaveClass('min-w-0')
    expect(detectedLabel).toHaveClass('min-w-0', 'truncate')
    expect(detectedLabel).toHaveAttribute('title', 'English')
  })

  it('toggles the original text after the auxiliary controls are regrouped', async () => {
    state.detectLanguage.mockResolvedValue('en-us')

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))

    fireEvent.click(
      screen.getByRole('button', {
        name: 'selection.action.window.original_show'
      })
    )
    expect(screen.getByText('There is no default export.')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'selection.action.window.original_hide'
      })
    )
    expect(screen.queryByText('There is no default export.')).not.toBeInTheDocument()
  })

  it('opens language settings without focusing and opening the first language selector', async () => {
    state.detectLanguage.mockResolvedValue('en-us')

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))

    const settingsButton = document.querySelector('.lucide-settings-2')?.closest('button')
    expect(settingsButton).toBeInTheDocument()
    fireEvent.click(settingsButton!)

    const preferredTargetLabel = await screen.findByText('translate.preferred_target')
    const settingsContent = preferredTargetLabel.closest<HTMLElement>('[data-slot="popover-content"]')
    expect(settingsContent).toBeInTheDocument()
    expect(settingsContent).not.toHaveClass('bg-card')

    const settingsComboboxes = settingsContent!.querySelectorAll('[role="combobox"]')
    expect(settingsComboboxes).toHaveLength(2)
    for (const combobox of settingsComboboxes) {
      expect(combobox.closest('.inline-flex')).toHaveClass('w-full', '[&>div]:w-full')
    }

    await waitFor(() => expect(settingsContent).toHaveFocus())
    expect(document.querySelectorAll('[data-slot="popover-content"]')).toHaveLength(1)
  })
})
