import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fileMock = vi.hoisted(() => ({
  onSelectFile: vi.fn(),
  readText: vi.fn(),
  isTextFile: vi.fn()
}))

const dropMock = vi.hoisted(() => ({
  getFilesFromDropEvent: vi.fn(),
  getTextFromDropEvent: vi.fn()
}))

const translateCoreMock = vi.hoisted(() => ({
  addHistory: vi.fn(),
  detectLanguage: vi.fn(),
  setTimeoutTimer: vi.fn(),
  translateText: vi.fn(),
  determineTargetLanguage: vi.fn(),
  abortCompletion: vi.fn(),
  isAbortError: vi.fn(),
  formatErrorMessageWithPrefix: vi.fn((_: unknown, prefix: string) => prefix)
}))
const loggerWarnMock = vi.hoisted(() => vi.fn())
const clipboardWriteTextMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
      <button type="button" {...props}>
        {children}
      </button>
    )
  }
})

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveIcon: () => undefined
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Selector', () => ({
  ModelSelector: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    shikiMarkdownIt: vi.fn().mockResolvedValue('')
  })
}))

vi.mock('@renderer/hooks/translate', () => ({
  useTranslateHistory: () => ({ add: translateCoreMock.addHistory })
}))

vi.mock('@renderer/hooks/translate/useDetectLang', () => ({
  useDetectLang: () => translateCoreMock.detectLanguage
}))

vi.mock('@renderer/hooks/useDrag', () => ({
  useDrag: (onDrop?: (event: React.DragEvent<HTMLDivElement>) => void) => ({
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: onDrop ?? vi.fn()
  })
}))

vi.mock('@renderer/hooks/useFiles', () => ({
  useFiles: () => ({
    onSelectFile: fileMock.onSelectFile,
    selecting: false,
    clearFiles: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: () => ({
    models: [
      {
        id: 'openai::gpt-4.1',
        providerId: 'openai',
        name: 'GPT-4.1',
        capabilities: [],
        isHidden: false
      }
    ]
  })
}))

vi.mock('@renderer/hooks/useOcr', () => ({
  useOcr: () => ({ ocr: vi.fn() })
}))

vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: () => [false, vi.fn()]
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: translateCoreMock.setTimeoutTimer })
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: loggerWarnMock,
      info: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/TokenService', () => ({
  estimateTextTokens: (text: string) => text.length
}))

vi.mock('@renderer/services/TranslateService', () => ({
  translateText: translateCoreMock.translateText
}))

vi.mock('@renderer/utils', () => ({
  getFileExtension: () => 'txt',
  isTextFile: fileMock.isTextFile,
  uuid: () => 'abort-key'
}))

vi.mock('@renderer/utils/abortController', () => ({
  abortCompletion: translateCoreMock.abortCompletion
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: translateCoreMock.formatErrorMessageWithPrefix,
  isAbortError: translateCoreMock.isAbortError
}))

vi.mock('@renderer/utils/input', () => ({
  getFilesFromDropEvent: dropMock.getFilesFromDropEvent,
  getTextFromDropEvent: dropMock.getTextFromDropEvent
}))

vi.mock('@renderer/utils/translate', () => ({
  createInputScrollHandler: () => vi.fn(),
  createOutputScrollHandler: () => vi.fn(),
  determineTargetLanguage: translateCoreMock.determineTargetLanguage,
  UNKNOWN_LANG_CODE: 'unknown'
}))

vi.mock('../components/IconButton', () => ({
  default: (props: React.ComponentProps<'button'> & { active?: boolean; size?: string }) => {
    const { active, children, size, ...buttonProps } = props
    void active
    void size
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  }
}))

vi.mock('../components/TranslateHistory', () => ({
  default: () => null
}))

vi.mock('../components/TranslateInputPane', () => ({
  default: ({
    text,
    onTextChange,
    onKeyDown,
    onSelectFile,
    onDrop,
    tokenCount
  }: {
    text: string
    onTextChange: (value: string) => void
    onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
    onSelectFile: () => void
    onDrop: (event: React.DragEvent<HTMLDivElement>) => void
    tokenCount: number
  }) => (
    <div data-testid="translate-input-pane" onDrop={onDrop}>
      <textarea
        aria-label="translate.input.placeholder"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" aria-label="common.upload_files" onClick={onSelectFile} />
      <span data-testid="token-count">{tokenCount}</span>
    </div>
  )
}))

vi.mock('../components/TranslateLanguageBar', () => ({
  default: () => null
}))

vi.mock('../components/TranslateOutputPane', () => ({
  default: ({
    translating,
    onTranslate,
    onAbort
  }: {
    translating: boolean
    onTranslate: () => Promise<void> | void
    onAbort: () => void
  }) =>
    translating ? (
      <button type="button" aria-label="common.stop" onClick={onAbort}>
        common.stop
      </button>
    ) : (
      <button type="button" onClick={() => void onTranslate()}>
        translate.button.translate
      </button>
    )
}))

vi.mock('../TranslateSettings', () => ({
  default: () => null
}))

import TranslatePage from '../TranslatePage'

describe('TranslatePage', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseCacheUtils.setCacheValue('translate.translating', { isTranslating: false, abortKey: null })
    MockUseCacheUtils.setCacheValue('translate.input', '')
    MockUseCacheUtils.setCacheValue('translate.output', '')
    MockUseCacheUtils.setCacheValue('translate.detecting', false)
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': null,
      'feature.translate.page.source_language': 'auto',
      'feature.translate.page.target_language': 'en-us',
      'feature.translate.model_prompt': '',
      'feature.translate.page.auto_copy': false,
      'feature.translate.page.bidirectional_pair': ['en-us', 'zh-cn'],
      'feature.translate.page.scroll_sync': false,
      'feature.translate.page.bidirectional_enabled': false,
      'feature.translate.page.enable_markdown': false
    })
    fileMock.onSelectFile.mockReset()
    fileMock.readText.mockReset()
    fileMock.isTextFile.mockResolvedValue(true)
    dropMock.getFilesFromDropEvent.mockReset()
    dropMock.getFilesFromDropEvent.mockResolvedValue(null)
    dropMock.getTextFromDropEvent.mockReset()
    dropMock.getTextFromDropEvent.mockResolvedValue(null)
    translateCoreMock.addHistory.mockReset()
    translateCoreMock.addHistory.mockResolvedValue(undefined)
    translateCoreMock.detectLanguage.mockReset()
    translateCoreMock.detectLanguage.mockResolvedValue('en-us')
    translateCoreMock.setTimeoutTimer.mockReset()
    translateCoreMock.translateText.mockReset()
    translateCoreMock.translateText.mockResolvedValue('translated text')
    translateCoreMock.determineTargetLanguage.mockReset()
    translateCoreMock.determineTargetLanguage.mockReturnValue({ success: true, language: 'zh-cn' })
    translateCoreMock.abortCompletion.mockReset()
    translateCoreMock.isAbortError.mockReset()
    translateCoreMock.isAbortError.mockReturnValue(false)
    translateCoreMock.formatErrorMessageWithPrefix.mockReset()
    translateCoreMock.formatErrorMessageWithPrefix.mockImplementation((_: unknown, prefix: string) => prefix)
    loggerWarnMock.mockReset()
    clipboardWriteTextMock.mockReset()
    clipboardWriteTextMock.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    })
    ;(window as any).toast = {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
    ;(window as any).api = {
      file: {
        readExternal: vi.fn()
      },
      fs: {
        readText: fileMock.readText
      }
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('appends selected file text to the latest input after async read completes', async () => {
    let resolveRead: (value: string) => void = () => {}
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )

    const { rerender } = render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'common.upload_files' }))
    await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))

    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), {
      target: { value: 'typed while reading ' }
    })
    rerender(<TranslatePage />)

    await act(async () => {
      resolveRead('file content')
    })

    await waitFor(() => {
      expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('typed while reading file content')
    })
    rerender(<TranslatePage />)
    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('typed while reading file content')
  })

  it('ignores empty text data when handling drops', async () => {
    dropMock.getTextFromDropEvent.mockResolvedValue('')

    render(<TranslatePage />)

    fireEvent.drop(screen.getByTestId('translate-input-pane'))

    await waitFor(() => expect(dropMock.getTextFromDropEvent).toHaveBeenCalled())
    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('')
  })

  it('shows token count as 0 when input is empty and non-zero after typing', async () => {
    const { rerender } = render(<TranslatePage />)

    expect(screen.getByTestId('token-count')).toHaveTextContent('0')

    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), {
      target: { value: 'abc' }
    })
    rerender(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect(screen.getByTestId('token-count')).toHaveTextContent('3'))
  })

  it('keeps translating enabled for plain-text paste without entering file-processing state', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.paste(screen.getByLabelText('translate.input.placeholder'), {
      clipboardData: {
        getData: () => 'pasted text',
        files: []
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))
  })

  it('shows warning and skips translate when source and target language are the same', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn',
      'feature.translate.page.target_language': 'en-us'
    })
    translateCoreMock.determineTargetLanguage.mockReturnValueOnce({ success: false, errorType: 'same_language' })

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect((window as any).toast.warning).toHaveBeenCalledWith('translate.language.same'))
    expect(translateCoreMock.translateText).not.toHaveBeenCalled()
  })

  it('shows unknown-language warning and skips translate when detection returns unknown', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'auto'
    })
    translateCoreMock.detectLanguage.mockResolvedValueOnce('unknown')

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect((window as any).toast.error).toHaveBeenCalledWith('translate.error.detect.unknown'))
    expect(translateCoreMock.translateText).not.toHaveBeenCalled()
  })

  it('shows aborted info and resets translating state when translate throws abort error', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    const abortError = new Error('aborted')
    translateCoreMock.translateText.mockRejectedValueOnce(abortError)
    translateCoreMock.isAbortError.mockImplementationOnce((error: unknown) => error === abortError)

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect((window as any).toast.info).toHaveBeenCalledWith('translate.info.aborted'))
    expect(MockUseCacheUtils.getCacheValue('translate.translating')).toEqual({ isTranslating: false, abortKey: null })
  })

  it('shows failure toast and resets translating state when translate throws non-abort error', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    const translateError = new Error('translate failed')
    translateCoreMock.translateText.mockRejectedValueOnce(translateError)
    translateCoreMock.formatErrorMessageWithPrefix.mockImplementationOnce((_error: unknown, prefix: string) => {
      return `${prefix}: reason`
    })

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect((window as any).toast.error).toHaveBeenCalledWith('translate.error.failed: reason'))
    expect(MockUseCacheUtils.getCacheValue('translate.translating')).toEqual({ isTranslating: false, abortKey: null })
  })

  it('triggers translate on Cmd/Ctrl+Enter keyboard shortcut', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    translateCoreMock.translateText.mockResolvedValueOnce('keyboard translated')

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)

    fireEvent.keyDown(screen.getByLabelText('translate.input.placeholder'), { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))
  })

  it('ignores duplicate translate trigger while translating is in progress', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    let resolveTranslate: (value: string) => void = () => {}
    translateCoreMock.translateText.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveTranslate = resolve
      })
    )

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'common.stop' }))
    rerender(<TranslatePage />)

    await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))
    await act(async () => {
      resolveTranslate('done')
    })
  })

  it('aborts in-flight translation and clears translating state on unmount', () => {
    MockUseCacheUtils.setCacheValue('translate.translating', { isTranslating: true, abortKey: 'abort-key-1' })

    const { unmount } = render(<TranslatePage />)
    unmount()

    expect(translateCoreMock.abortCompletion).toHaveBeenCalledWith('abort-key-1')
    expect(MockUseCacheUtils.getCacheValue('translate.translating')).toEqual({ isTranslating: false, abortKey: null })
  })

  it('logs warning when abort is triggered without abortKey', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.translating', { isTranslating: true, abortKey: '' })
    MockUseCacheUtils.setCacheValue('translate.input', 'hello')

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'common.stop' }))

    expect(loggerWarnMock).toHaveBeenCalledWith('Abort requested without active abort key', {
      isTranslating: true,
      abortKey: ''
    })
    expect(translateCoreMock.abortCompletion).not.toHaveBeenCalled()
  })

  it('schedules auto-copy after successful translation when auto-copy is enabled', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn',
      'feature.translate.page.auto_copy': true
    })

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() =>
      expect(translateCoreMock.setTimeoutTimer).toHaveBeenCalledWith('auto-copy', expect.any(Function), 100)
    )

    const autoCopyCallback = translateCoreMock.setTimeoutTimer.mock.calls[0]?.[1] as (() => Promise<void>) | undefined
    expect(autoCopyCallback).toBeTypeOf('function')
    await act(async () => {
      await autoCopyCallback?.()
    })

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('translated text')
  })
})
