import '@testing-library/jest-dom/vitest'
import { mockPreferenceService } from '@test-mocks/renderer/PreferenceService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as RendererIpc from '@renderer/ipc'
import {
  parsePersistedLangCode,
  type SelectionActionItem,
  type TranslateLangCode
} from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'

const state = vi.hoisted(() => {
  const english = { langCode: 'en-us', value: 'English', emoji: '🇺🇸' }
  const chinese = { langCode: 'zh-cn', value: 'Chinese (Simplified)', emoji: '🇨🇳' }
  const traditionalChinese = { langCode: 'zh-tw', value: 'Chinese (Traditional)', emoji: '🇭🇰' }
  const japanese = { langCode: 'ja-jp', value: 'Japanese', emoji: '🇯🇵' }
  const languages = [chinese, traditionalChinese, english, japanese]

  return {
    quickModel: undefined as { id: string; modelId: string } | undefined,
    useRealDetection: false,
    english,
    chinese,
    traditionalChinese,
    japanese,
    languages,
    getLanguage: vi.fn((langCode: TranslateLangCode) => languages.find((lang) => lang.langCode === langCode) ?? null),
    getLabel: vi.fn((language: TranslateLanguage) => language.value),
    detectLanguage: vi.fn(),
    translate: vi.fn(),
    readAloud: vi.fn(async () => undefined),
    scrollToBottom: vi.fn()
  }
})

vi.mock('@renderer/utils/translate/translateText', () => ({
  translateText: async (
    text: string,
    language: TranslateLanguage,
    onResponse?: (text: string, done: boolean) => void
  ) => {
    const result = await state.translate(text, language)
    onResponse?.(result, true)
    return result
  }
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ quickModel: state.quickModel })
}))

vi.mock('@renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof RendererIpc>()),
  ipcApi: { request: vi.fn().mockResolvedValue({ text: 'zh-cn' }) }
}))

vi.mock('@renderer/services/voice', () => ({ readTextAloud: state.readAloud }))

const i18nMock = vi.hoisted(() => ({
  t: vi.fn((key: string, fallback?: string) => fallback ?? key)
}))

import ActionTranslate from '../ActionTranslate'

const defaultUsePreferenceImplementation = mockUsePreference.getMockImplementation()

vi.mock('../ActionResultContent', () => {
  return {
    default: function ActionResultContentMock({
      partsByMessageId
    }: {
      partsByMessageId: Record<string, { type: string; text?: string }[]>
    }) {
      return (
        <div data-testid="action-result-content">
          {Object.values(partsByMessageId)
            .flat()
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')}
        </div>
      )
    }
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/hooks/translate', async () => {
  const { useTranslate } = await import('@renderer/hooks/translate/useTranslate')
  const { useDetectLang } = await import('@renderer/hooks/translate/useDetectLang')
  return {
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
    useDetectLang: () => {
      const detect = useDetectLang()
      return state.useRealDetection ? detect : state.detectLanguage
    },
    useTranslate,
    useLanguages: () => ({
      languages: state.languages as TranslateLanguage[],
      getLanguage: state.getLanguage,
      getLabel: state.getLabel
    })
  }
})

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
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="window-footer">{children}</div>
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
    if (defaultUsePreferenceImplementation) {
      mockUsePreference.mockImplementation(defaultUsePreferenceImplementation)
    }
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.language': 'zh-CN',
      'feature.translate.action.preferred_lang': 'zh-cn',
      'feature.translate.action.alter_lang': 'en-us'
    })
    state.quickModel = undefined
    state.useRealDetection = false
    state.detectLanguage.mockReset()
    state.getLanguage.mockClear()
    state.getLabel.mockClear()
    state.translate.mockReset()
    state.scrollToBottom.mockReset()
    state.translate.mockImplementation(
      async (_text: string, language: TranslateLanguage) =>
        ({
          'zh-cn': '这里没有默认导出。',
          'zh-tw': '這裡沒有預設匯出。',
          'ja-jp': 'デフォルトのエクスポートはありません。',
          'en-us': 'There is no default export.'
        })[language.langCode] ?? 'translated text'
    )
    state.readAloud.mockClear()
  })

  it('keeps the active result when detection callbacks refresh without changed inputs', async () => {
    state.quickModel = { id: 'regression::quick', modelId: 'quick' }
    state.detectLanguage.mockResolvedValue('en-us')
    const pending: Array<(text: string) => void> = []
    state.translate.mockImplementation(() => new Promise<string>((resolve) => pending.push(resolve)))
    const action = createAction()
    const view = render(
      <ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />
    )
    await waitFor(() => expect(pending).toHaveLength(1))

    state.detectLanguage = vi.fn().mockResolvedValue('en-us')
    state.quickModel = { ...state.quickModel }
    view.rerender(
      <ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />
    )
    await act(async () => pending[0]('首次翻译完成'))
    expect(await screen.findByText('首次翻译完成')).toBeVisible()

    view.rerender(
      <ActionTranslate
        sourceEntityId="test-session"
        action={createAction({ selectedText: 'A different selection.' })}
        scrollToBottom={state.scrollToBottom}
      />
    )
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[1]('新选区翻译完成'))
    expect(await screen.findByText('新选区翻译完成')).toBeVisible()
    expect(screen.queryByText('首次翻译完成')).not.toBeInTheDocument()
  })

  it('keeps an offline-detected translation active when the quick model finishes loading', async () => {
    state.useRealDetection = true
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.auto_detection_method': 'franc',
      'feature.translate.model_id': 'regression::translate'
    })
    MockUseDataApiUtils.mockQueryResult('/translate/languages', {
      data: state.languages.map((language) => ({
        ...language,
        langCode: parsePersistedLangCode(language.langCode),
        createdAt: '2026-11-08T00:00:00.000Z',
        updatedAt: '2026-11-08T00:00:00.000Z'
      }))
    })
    const pending: Array<(text: string) => void> = []
    state.translate.mockImplementation(() => new Promise<string>((resolve) => pending.push(resolve)))
    const action = createAction({
      selectedText: 'The early bird catches the worm. Preparation and timely action improve the chances of success.'
    })
    const view = render(
      <ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    expect(screen.getByRole('combobox')).toBeDisabled()

    state.quickModel = { id: 'regression::quick', modelId: 'quick' }
    view.rerender(
      <ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />
    )
    await act(async () => pending[0]('早起的鸟儿有虫吃。'))

    expect(await screen.findByText('早起的鸟儿有虫吃。')).toBeVisible()
    expect(screen.getByRole('combobox')).toBeEnabled()
  })

  it('corrects the fallback target when the quick model finishes loading', async () => {
    state.useRealDetection = true
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.auto_detection_method', 'llm')
    MockUseDataApiUtils.mockQueryResult('/translate/languages', {
      data: state.languages.map((language) => ({
        ...language,
        langCode: parsePersistedLangCode(language.langCode),
        createdAt: '2026-11-08T00:00:00.000Z',
        updatedAt: '2026-11-08T00:00:00.000Z'
      }))
    })
    const action = createAction({ selectedText: '你好' })
    const view = render(
      <ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />
    )
    expect(await screen.findByText('这里没有默认导出。')).toBeVisible()

    state.quickModel = { id: 'regression::quick', modelId: 'quick' }
    view.rerender(
      <ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />
    )

    expect(await screen.findByText('There is no default export.')).toBeVisible()
    expect(screen.queryByText('这里没有默认导出。')).not.toBeInTheDocument()
  })

  it('uses Traditional Chinese when the app language is zh-TW and the target is still the default', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.language', 'zh-TW')
    state.detectLanguage.mockResolvedValue('en-us')

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

    expect(await screen.findByText('這裡沒有預設匯出。')).toBeVisible()
  })

  it('keeps a non-default target language when the app language is zh-TW', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.language': 'zh-TW',
      'feature.translate.action.preferred_lang': 'ja-jp'
    })
    state.detectLanguage.mockResolvedValue('en-us')

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

    expect(await screen.findByText('デフォルトのエクスポートはありません。')).toBeVisible()
  })

  it('starts the first request with the saved languages when they load after the language list', async () => {
    let resolveSaved: (codes: Record<string, unknown>) => void = () => {}
    mockPreferenceService.getMultiple.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveSaved = resolve
        })
    )
    let resolveDetect: (langCode: TranslateLangCode) => void = () => {}
    state.detectLanguage.mockReturnValue(
      new Promise<TranslateLangCode>((resolve) => {
        resolveDetect = resolve
      })
    )

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )
    expect(state.detectLanguage).not.toHaveBeenCalled()

    await act(async () => resolveSaved({ preferred: 'en-us', alter: 'zh-cn' }))
    // The dropdown must show the saved target while detection is still running.
    expect(screen.getByRole('combobox')).toHaveDisplayValue(/English/)

    await act(async () => resolveDetect('ja-jp'))
    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.english))
    expect(state.translate).toHaveBeenCalledTimes(1)
  })

  it('keeps the session language pair when another window saves a different target', async () => {
    state.detectLanguage.mockResolvedValue('ja-jp')
    const action = createAction()

    const { rerender } = render(
      <ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />
    )
    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))

    MockUsePreferenceUtils.setPreferenceValue('feature.translate.action.preferred_lang', 'en-us')
    rerender(<ActionTranslate sourceEntityId="test-session" action={action} scrollToBottom={state.scrollToBottom} />)
    await act(async () => {})

    expect(state.translate).toHaveBeenCalledTimes(1)
  })

  it('continues translating to the target language when source detection throws', async () => {
    state.detectLanguage.mockRejectedValue(new Error('detect exploded'))

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))
    expect(screen.queryByText('detect exploded')).not.toBeInTheDocument()
  })

  it('shows automatic detection when no concrete source language is available', async () => {
    state.detectLanguage.mockResolvedValueOnce('unknown')

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

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

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

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

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

    expect(await screen.findByText('error.diagnosis.model')).toBeInTheDocument()
    expect(screen.queryByText("Model with id 'provider/model' not found")).not.toBeInTheDocument()
  })

  it('reads a completed translation result only after the response is final', async () => {
    state.detectLanguage.mockResolvedValue('en-us')
    let resolveTranslate: (value: string) => void = () => {}
    state.translate.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveTranslate = resolve
      })
    )
    render(
      <ActionTranslate
        action={createAction({ selectedText: 'PRIVATE_ORIGINAL' })}
        sourceEntityId="opaque-session"
        scrollToBottom={state.scrollToBottom}
      />
    )
    await waitFor(() => expect(state.translate).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'selection.action.voice.read_result' })).not.toBeInTheDocument()
    await act(async () => resolveTranslate('PRIVATE_TRANSLATION'))
    fireEvent.click(await screen.findByRole('button', { name: 'selection.action.voice.read_result' }))
    expect(state.readAloud).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'PRIVATE_TRANSLATION',
        mode: 'document',
        sourceLabel: 'preview',
        sourceEntityId: 'opaque-session'
      })
    )
  })

  it('toggles the original text after the auxiliary controls are regrouped', async () => {
    state.detectLanguage.mockResolvedValue('en-us')

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

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

    render(
      <ActionTranslate sourceEntityId="test-session" action={createAction()} scrollToBottom={state.scrollToBottom} />
    )

    await waitFor(() => expect(state.translate).toHaveBeenCalledWith('There is no default export.', state.chinese))

    const settingsButton = document.querySelector('.lucide-settings-2')?.closest('button')
    expect(settingsButton).toBeInTheDocument()
    fireEvent.click(settingsButton!)

    const preferredTargetLabel = await screen.findByText('translate.preferred_target')
    const settingsContent = preferredTargetLabel.closest<HTMLElement>('[data-slot="popover-content"]')
    expect(settingsContent).toBeInTheDocument()

    await waitFor(() => expect(settingsContent).toHaveFocus())
    expect(document.querySelectorAll('[data-slot="popover-content"]')).toHaveLength(1)
  })
})
