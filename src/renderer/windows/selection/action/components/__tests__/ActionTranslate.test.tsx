import '@testing-library/jest-dom/vitest'

import type { SelectionActionItem, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const english = { langCode: 'en-us', value: 'English', emoji: '🇺🇸' }
  const chinese = { langCode: 'zh-cn', value: 'Chinese', emoji: '🇨🇳' }

  return {
    english,
    chinese,
    languages: [chinese, english],
    detectLanguage: vi.fn(),
    translate: vi.fn(),
    cancel: vi.fn(),
    scrollToBottom: vi.fn()
  }
})

import ActionTranslate from '../ActionTranslate'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Popover: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
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
    getLanguage: (langCode: TranslateLangCode) =>
      (state.languages as TranslateLanguage[]).find((lang) => lang.langCode === langCode) ?? null
  })
}))

vi.mock('@renderer/components/LanguageSelect', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="language-select">{value}</div>
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
    t: (key: string, fallback?: string) => fallback ?? key
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
    state.translate.mockReset()
    state.cancel.mockReset()
    state.scrollToBottom.mockReset()
    state.translate.mockResolvedValue('translated text')
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
})
