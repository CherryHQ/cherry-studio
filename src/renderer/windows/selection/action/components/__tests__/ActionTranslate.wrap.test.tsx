import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { SelectionActionItem, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const english = { langCode: 'en-us', value: 'English', emoji: '🇺🇸' }
  const chinese = { langCode: 'zh-cn', value: 'Chinese (Simplified)', emoji: '🇨🇳' }
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
    scrollToBottom: vi.fn(),
    onResponse: undefined as ((text: string) => void) | undefined,
    runTranslate: async (text: string, language: TranslateLanguage) => {
      const result = await state.translate(text, language)
      state.onResponse?.(result)
      return result
    }
  }
})

const mocks = vi.hoisted(() => ({
  CodeViewer: vi.fn(({ value, wrapped }: { value: string; wrapped?: boolean }) => (
    <pre aria-label="Code viewer" data-wrapped={wrapped ? 'true' : 'false'}>
      {value}
    </pre>
  ))
}))

const defaultUsePreferenceImplementation = mockUsePreference.getMockImplementation()
const FENCED_TRANSLATION = `\`\`\`js\nconst token = '${'a'.repeat(240)}'\n\`\`\``

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
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
  useTranslate: ({ onResponse }: { onResponse?: (text: string) => void }) => {
    state.onResponse = onResponse
    return {
      translate: state.runTranslate,
      isTranslating: false,
      cancel: state.cancel
    }
  },
  useLanguages: () => ({
    languages: state.languages as TranslateLanguage[],
    getLanguage: state.getLanguage,
    getLabel: state.getLabel
  })
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: mocks.CodeViewer
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@renderer/services/PyodideService', () => ({
  pyodideService: { runScript: vi.fn() }
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => <button type="button">copy</button>
}))

vi.mock('../WindowFooter', () => ({
  default: () => <div data-testid="window-footer" />
}))

const i18nMock = vi.hoisted(() => ({
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: i18nMock.t
  })
}))

import ActionTranslate from '../ActionTranslate'

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

beforeAll(async () => {
  Element.prototype.scrollIntoView = vi.fn()
  // ChatMarkdown lazy-loads this runtime; preload so the fence is not stuck on the fallback.
  await import('@renderer/components/chat/messages/markdown/ChatMarkdownRuntime')
})

describe('ActionTranslate result wrap', () => {
  beforeEach(() => {
    if (defaultUsePreferenceImplementation) {
      mockUsePreference.mockImplementation(defaultUsePreferenceImplementation)
    }
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.language': 'zh-CN',
      'feature.translate.action.preferred_lang': 'zh-cn',
      'feature.translate.action.alter_lang': 'en-us',
      'chat.code.wrappable': false,
      'chat.code.editor.enabled': false,
      'chat.code.collapsible': false,
      'chat.code.fancy_block': true
    })
    state.detectLanguage.mockReset()
    state.getLanguage.mockClear()
    state.getLabel.mockClear()
    state.translate.mockReset()
    state.cancel.mockReset()
    state.scrollToBottom.mockReset()
    mocks.CodeViewer.mockClear()
    state.detectLanguage.mockResolvedValue('en-us')
    state.translate.mockResolvedValue(FENCED_TRANSLATION)
  })

  it('wraps a translated fenced code block even when chat wrap is off', async () => {
    // Regression: selection-translation results were clipped because wrap
    // followed chat.code.wrappable (default off) instead of the translate pane.
    render(<ActionTranslate action={createAction()} scrollToBottom={state.scrollToBottom} />)

    const viewer = await screen.findByLabelText('Code viewer', {}, { timeout: 10_000 })
    expect(viewer).toHaveAttribute('data-wrapped', 'true')
    expect(viewer).toHaveTextContent(`const token = '${'a'.repeat(240)}'`)
  })
})
