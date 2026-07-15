import '@testing-library/jest-dom/vitest'

import type { SelectionActionItem, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { act, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const english = { langCode: 'en-us', value: 'English', emoji: '🇺🇸' }
  const chinese = { langCode: 'zh-cn', value: 'Chinese', emoji: '🇨🇳' }
  const languages = [chinese, english]

  return {
    english,
    chinese,
    languages,
    getLanguage: vi.fn((langCode: TranslateLangCode) => languages.find((lang) => lang.langCode === langCode) ?? null),
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

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Popover: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverContent: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
    <div data-testid="popover-content" className={className}>
      {children}
    </div>
  ),
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
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
    getLanguage: state.getLanguage
  })
}))

vi.mock('@renderer/components/LanguageSelect', () => ({
  default: ({
    value,
    className,
    popoverClassName
  }: {
    value?: string
    className?: string
    popoverClassName?: string
  }) => (
    <div data-testid="language-select" data-class={className} data-popover-class={popoverClassName}>
      {value}
    </div>
  )
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

describe('ActionTranslate', () => {
  beforeEach(() => {
    state.detectLanguage.mockReset()
    state.getLanguage.mockClear()
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

  it('keeps action-window language dropdowns aligned with the card surface', () => {
    state.detectLanguage.mockReturnValue(new Promise<never>(() => {}))

    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    const languageSelects = screen.getAllByTestId('language-select')
    for (const select of languageSelects) {
      expect(select).toHaveAttribute(
        'data-popover-class',
        '!w-[var(--radix-popover-trigger-width)] bg-card [&_[data-slot=command]]:bg-card'
      )
    }
    expect(languageSelects[1]).toHaveAttribute('data-class', 'w-full [&>div]:w-full')
    expect(languageSelects[2]).toHaveAttribute('data-class', 'w-full [&>div]:w-full')
    expect(screen.getByTestId('popover-content')).toHaveClass('bg-card')
  })

  it('uses the icon color token for language settings and help', () => {
    state.detectLanguage.mockReturnValue(new Promise<never>(() => {}))

    const { container } = render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    expect(container.querySelector('.lucide-settings-2')?.closest('button')).toHaveClass('text-icon', 'dark:text-icon')
    expect(container.querySelector('.lucide-circle-question-mark')).toHaveClass('text-icon')
  })
})
