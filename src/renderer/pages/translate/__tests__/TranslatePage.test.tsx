import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CacheHooks from '@data/hooks/useCache'
import type * as TranslateHooks from '@renderer/hooks/translate'
import { toast } from '@renderer/services/toast'
import type * as TranslateUtils from '@renderer/utils/translate'
import type { BinaryToolSnapshot } from '@shared/types/binary'
import type { AbsoluteFilePath } from '@shared/types/file'

import type TranslateLanguageBarComponent from '../components/TranslateLanguageBar'
import type { TranslationFiles } from '../translationFiles'

const fileMock = vi.hoisted(() => ({
  onSelectFile: vi.fn(),
  readText: vi.fn(),
  readExternal: vi.fn(),
  startJob: vi.fn(),
  getFileExtension: vi.fn(() => 'txt'),
  isTextFile: vi.fn(),
  getPathForFile: vi.fn(),
  createTempFile: vi.fn(),
  write: vi.fn(),
  get: vi.fn()
}))

const useJobMock = vi.hoisted(() => vi.fn())
const cacheHookMode = vi.hoisted(() => ({ realContent: false }))
const smoothStreamMock = vi.hoisted(() => ({
  deferUpdates: false,
  pendingUpdates: [] as Array<() => void>
}))
const uuidMock = vi.hoisted(() => vi.fn(() => 'abort-key'))
const ipcRequestMock = vi.hoisted(() => vi.fn())
const ipcEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())
const babeldocInstalledSnapshot: BinaryToolSnapshot = {
  name: 'babeldoc-stream',
  availability: { source: 'mise', path: '/shims/babeldoc-stream' },
  application: { status: 'applied', version: '0.6.4.post4' }
}
const binaryMock = vi.hoisted(() => ({
  snapshots: {
    'babeldoc-stream': {
      name: 'babeldoc-stream',
      availability: { source: 'mise', path: '/shims/babeldoc-stream' },
      application: { status: 'applied', version: '0.6.4.post4' }
    }
  } as Record<string, BinaryToolSnapshot>
}))

const dropMock = vi.hoisted(() => ({
  getFilesFromDropEvent: vi.fn(),
  getTextFromDropEvent: vi.fn()
}))

const translateCoreMock = vi.hoisted(() => ({
  addHistory: vi.fn(),
  updateHistory: vi.fn(),
  historyHookOptions: vi.fn(),
  detectLanguage: vi.fn(),
  setTimeoutTimer: vi.fn(),
  translateText: vi.fn(),
  isAbortError: vi.fn(),
  formatErrorMessageWithPrefix: vi.fn((_: unknown, prefix: string) => prefix)
}))
const loggerWarnMock = vi.hoisted(() => vi.fn())
const loggerErrorMock = vi.hoisted(() => vi.fn())
const clipboardWriteTextMock = vi.hoisted(() => vi.fn())
const modelSelectorMock = vi.hoisted(() => vi.fn())
const languageBarMock = vi.hoisted(() => vi.fn())
const translateInputPaneMock = vi.hoisted(() => vi.fn())
const exportContentToNotesMock = vi.hoisted(() => vi.fn())
const pdfViewMock = vi.hoisted(() => vi.fn())
const pdfHandleMock = vi.hoisted(() => ({ cancel: vi.fn(), start: vi.fn() }))
const languageFixtures = vi.hoisted(() => [
  { langCode: 'en-us', value: 'English', emoji: '🇬🇧' },
  { langCode: 'zh-cn', value: 'Chinese', emoji: '🇨🇳' },
  { langCode: 'ja-jp', value: 'Japanese', emoji: '🇯🇵' }
])
const historyFilesMock = vi.hoisted(() => ({
  files: {
    source: { entryId: 'entry-source', path: '/tmp/paper.pdf' as AbsoluteFilePath },
    target: { entryId: 'entry-target', path: '/tmp/files/entry-target.pdf' as AbsoluteFilePath }
  } as TranslationFiles
}))

const createDeferredLanguagePersist = () => {
  let resolvePersist!: () => void
  const persistLanguages = vi.fn(
    (values: { sourceLanguage?: string; targetLanguage?: string }) =>
      new Promise<void>((resolve) => {
        resolvePersist = () => {
          MockUsePreferenceUtils.setMultiplePreferenceValues({
            'feature.translate.page.source_language': values.sourceLanguage,
            'feature.translate.page.target_language': values.targetLanguage
          })
          resolve()
        }
      })
  )
  return { persistLanguages, resolvePersist: () => resolvePersist() }
}

vi.mock('@data/hooks/useCache', async (importOriginal) => {
  const actual = await importOriginal<typeof CacheHooks>()
  const { MockUseCache } = await import('@test-mocks/renderer/useCache')
  return {
    ...MockUseCache,
    // This handoff must use the same CacheService store as the revision fence.
    useCache: ((key, initValue) =>
      key === 'translate.restored_pdf' ||
      key === 'translate.history_restore_pending' ||
      key === 'translate.exchange_pending' ||
      (cacheHookMode.realContent && (key === 'translate.input' || key === 'translate.output'))
        ? actual.useCache(key, initValue)
        : MockUseCache.useCache(key, initValue)) as typeof actual.useCache
  }
})

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
  resolveIconRef: () => undefined,
  useIcon: () => undefined
}))

vi.mock('@renderer/components/Navbar', () => ({
  Navbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: (props: { trigger: React.ReactNode }) => {
    modelSelectorMock(props)
    return <>{props.trigger}</>
  }
}))

vi.mock('@renderer/hooks/translate', async (importOriginal) => ({
  ...(await importOriginal<typeof TranslateHooks>()),
  useLanguages: () => ({
    languages: languageFixtures,
    getLanguage: (code: string) => languageFixtures.find((language) => language.langCode === code),
    getLabel: (language: string | (typeof languageFixtures)[number] | null, withEmoji = true) => {
      if (typeof language === 'string') return language
      if (!language) return 'Unknown'
      return withEmoji ? `${language.emoji} ${language.value}` : language.value
    }
  }),
  detectLanguageOrUnknown: async (
    text: string,
    detectLanguage: (text: string) => Promise<string>,
    onError: (error: unknown) => void
  ) => {
    try {
      return await detectLanguage(text)
    } catch (error) {
      onError(error)
      return 'unknown'
    }
  },
  useTranslateHistory: (options?: unknown) => {
    translateCoreMock.historyHookOptions(options)
    return { add: translateCoreMock.addHistory, update: translateCoreMock.updateHistory }
  }
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

vi.mock('@renderer/hooks/useJob', () => ({
  useJob: useJobMock
}))

const mockModel = {
  id: 'openai::gpt-4.1',
  providerId: 'openai',
  name: 'GPT-4.1',
  capabilities: [],
  isHidden: false
}

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [mockModel] }),
  useModelById: (uniqueModelId: string | null | undefined) => ({
    model: uniqueModelId === mockModel.id ? mockModel : undefined
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: translateCoreMock.setTimeoutTimer })
}))

vi.mock('@renderer/hooks/useSmoothStream', () => ({
  useSmoothStream: (options: { onUpdate: (text: string) => void }) => ({
    reset: (text = '') => options.onUpdate(text),
    update: (text: string) => {
      const applyUpdate = () => options.onUpdate(text)
      if (smoothStreamMock.deferUpdates) {
        smoothStreamMock.pendingUpdates.push(applyUpdate)
      } else {
        applyUpdate()
      }
    }
  })
}))

vi.mock('@renderer/services/ExportService', () => ({
  exportContentToNotes: exportContentToNotesMock
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    ipcEventHandlers.set(event, handler)
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock,
      warn: loggerWarnMock,
      info: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/utils/file', () => ({
  getFileExtension: fileMock.getFileExtension,
  isTextFile: fileMock.isTextFile
}))

vi.mock('@renderer/utils/uuid', () => ({
  uuid: uuidMock
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: translateCoreMock.formatErrorMessageWithPrefix,
  isAbortError: translateCoreMock.isAbortError
}))

vi.mock('@renderer/utils/input', () => ({
  getFilesFromDropEvent: dropMock.getFilesFromDropEvent,
  getTextFromDropEvent: dropMock.getTextFromDropEvent
}))

vi.mock('@renderer/utils/translate', async (importOriginal) => ({
  ...(await importOriginal<typeof TranslateUtils>()),
  createInputScrollHandler: () => vi.fn(),
  createOutputScrollHandler: () => vi.fn(),
  translateText: translateCoreMock.translateText
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
  default: ({
    isOpen,
    onHistoryItemClick
  }: {
    isOpen: boolean
    onHistoryItemClick: (
      history: {
        id?: string
        kind: 'text' | 'file'
        sourceText: string
        targetText: string
        sourceLanguage: string | null
        targetLanguage: string | null
      },
      files?: TranslationFiles
    ) => void
  }) =>
    isOpen ? (
      <div data-testid="translate-history-open">
        <button
          type="button"
          aria-label="reuse-null-target-history"
          onClick={() =>
            onHistoryItemClick({
              kind: 'text',
              sourceText: 'hello',
              targetText: '你好',
              sourceLanguage: null,
              targetLanguage: null
            })
          }
        />
        <button
          type="button"
          aria-label="reuse-text-history"
          onClick={() =>
            onHistoryItemClick({
              kind: 'text',
              sourceText: 'history input',
              targetText: 'history output',
              sourceLanguage: 'ja-jp',
              targetLanguage: 'en-us'
            })
          }
        />
        <button
          type="button"
          aria-label="reuse-other-text-history"
          onClick={() =>
            onHistoryItemClick({
              kind: 'text',
              sourceText: 'newer history input',
              targetText: 'newer history output',
              sourceLanguage: 'zh-cn',
              targetLanguage: 'ja-jp'
            })
          }
        />
        <button
          type="button"
          aria-label="reuse-pdf-history"
          onClick={() =>
            onHistoryItemClick(
              {
                id: 'history-pdf',
                kind: 'file',
                sourceText: 'paper.pdf',
                targetText: 'paper.zh-CN.pdf',
                sourceLanguage: null,
                targetLanguage: null
              },
              historyFilesMock.files
            )
          }
        />
        <button
          type="button"
          aria-label="reuse-other-pdf-history"
          onClick={() =>
            onHistoryItemClick(
              {
                id: 'history-other-pdf',
                kind: 'file',
                sourceText: 'other.pdf',
                targetText: 'other.ja-JP.pdf',
                sourceLanguage: 'zh-cn',
                targetLanguage: 'ja-jp'
              },
              {
                source: { entryId: 'entry-other-source', path: '/tmp/other.pdf' as AbsoluteFilePath },
                target: { entryId: 'entry-other-target', path: '/tmp/files/entry-other-target.pdf' as AbsoluteFilePath }
              }
            )
          }
        />
      </div>
    ) : null
}))

vi.mock('../components/TranslateInputPane', () => ({
  default: ({
    text,
    onTextChange,
    onKeyDown,
    onPaste,
    onSelectFile,
    onDrop,
    onCancelOcr,
    copied,
    onCopy,
    disabled,
    ocrProcessing
  }: {
    text: string
    onTextChange: (value: string) => void
    onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
    onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
    onSelectFile: () => void
    onDrop: (event: React.DragEvent<HTMLDivElement>) => void
    onCancelOcr: () => void
    copied: boolean
    onCopy: () => void
    disabled?: boolean
    ocrProcessing?: boolean
  }) => {
    translateInputPaneMock({ onSelectFile })
    return (
      <div data-testid="translate-input-pane" onDrop={onDrop}>
        <textarea
          aria-label="translate.input.placeholder"
          disabled={disabled}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button type="button" aria-label="translate.files.upload" onClick={onSelectFile} />
        <button type="button" aria-label="input.copy" onClick={onCopy} />
        <span data-testid="translate-input-copied">{String(copied)}</span>
        {ocrProcessing && (
          <div data-testid="translate-input-ocr-processing">
            ocr.processing
            <button type="button" onClick={() => onCancelOcr()}>
              common.cancel
            </button>
          </div>
        )}
      </div>
    )
  }
}))

vi.mock('../components/TranslateLanguageBar', async (importOriginal) => {
  const { default: TranslateLanguageBar } = await importOriginal<{ default: typeof TranslateLanguageBarComponent }>()

  return {
    default: (props: React.ComponentProps<typeof TranslateLanguageBar>) => {
      languageBarMock(props)
      return <TranslateLanguageBar {...props} />
    }
  }
})

vi.mock('../components/TranslateOutputPane', () => ({
  default: ({
    translating,
    translatedContent,
    copied,
    onCopy,
    onExportToNotes
  }: {
    translating: boolean
    translatedContent: string
    copied: boolean
    onCopy: () => void
    onExportToNotes?: () => void | Promise<void>
  }) => (
    <div data-testid="translate-output-pane">
      {translating && <span>translate.processing</span>}
      <span data-testid="translate-output-content">{translatedContent}</span>
      <button type="button" aria-label="output.copy" onClick={onCopy} />
      <span data-testid="translate-output-copied">{String(copied)}</span>
      <button type="button" aria-label="notes.save" onClick={() => void onExportToNotes?.()} />
    </div>
  )
}))

vi.mock('../TranslateSettings', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid="translate-settings-open" /> : null)
}))

vi.mock('../pdf/PdfTranslationView', () => {
  const MockPdfTranslationView = (props: {
    file: { name: string; path: string }
    modelId?: string
    sourceLangCode: string
    babelDocAvailability: 'checking' | 'available' | 'missing' | 'outdated'
    babelDocInstalling: boolean
    textFallback?: { content: React.ReactNode; ocrRequired: boolean }
    restoredOutput?: { outputPath: string; fileName: string } | null
    onClose: () => void
    onHandleChange: (handle: typeof pdfHandleMock | null) => void
    onStatusChange: (status: { phase: 'idle'; running: false }) => void
    onInstallBabelDoc: () => void
  }) => {
    const { onHandleChange, onStatusChange } = props
    const [stateFilePath] = useState(props.file.path)
    pdfViewMock(props)
    useEffect(() => {
      onHandleChange(pdfHandleMock)
      onStatusChange({ phase: 'idle', running: false })
      return () => onHandleChange(null)
    }, [onHandleChange, onStatusChange])
    return (
      <div
        data-testid="pdf-translation-view"
        data-file-path={props.file.path}
        data-state-file-path={stateFilePath}
        data-restored-output={props.restoredOutput?.outputPath}>
        <span data-testid="babeldoc-availability">{props.babelDocAvailability}</span>
        {(props.babelDocAvailability === 'missing' || props.babelDocAvailability === 'outdated') &&
          !props.textFallback && (
            <button
              type="button"
              aria-label={
                props.babelDocAvailability === 'outdated'
                  ? 'translate.pdf.action.update_babeldoc'
                  : 'translate.pdf.action.install_babeldoc'
              }
              onClick={props.onInstallBabelDoc}
            />
          )}
        {props.textFallback?.content}
        <button type="button" aria-label="translate.pdf.action.close" onClick={props.onClose} />
      </div>
    )
  }
  return { default: MockPdfTranslationView }
})

import TranslatePage from '../TranslatePage'

describe('TranslatePage', () => {
  beforeEach(() => {
    cacheHookMode.realContent = false
    MockCacheUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
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
    fileMock.readExternal.mockReset()
    fileMock.startJob.mockReset()
    fileMock.getFileExtension.mockReset()
    fileMock.getFileExtension.mockReturnValue('txt')
    fileMock.isTextFile.mockResolvedValue(true)
    fileMock.getPathForFile.mockReset()
    fileMock.createTempFile.mockReset()
    fileMock.write.mockReset()
    fileMock.write.mockResolvedValue(undefined)
    fileMock.get.mockReset()
    fileMock.startJob.mockResolvedValue({
      id: 'job-ocr-1',
      type: 'file-processing.background',
      status: 'pending'
    })
    ipcRequestMock.mockReset()
    ipcEventHandlers.clear()
    binaryMock.snapshots = { 'babeldoc-stream': babeldocInstalledSnapshot }
    ipcRequestMock.mockImplementation((channel: string, payload?: unknown) => {
      if (channel === 'file_processing.start_job') return fileMock.startJob(payload)
      if (channel === 'binary.get_tool_snapshots') return Promise.resolve(binaryMock.snapshots)
      if (channel === 'binary.install_tool') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })
    fileMock.readExternal.mockResolvedValue('document content')
    uuidMock.mockReset()
    uuidMock.mockReturnValue('abort-key')
    useJobMock.mockReset()
    useJobMock.mockReturnValue({ data: undefined, isTerminal: false })
    smoothStreamMock.deferUpdates = false
    smoothStreamMock.pendingUpdates.length = 0
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
    translateCoreMock.updateHistory.mockReset()
    translateCoreMock.updateHistory.mockResolvedValue(undefined)
    translateCoreMock.historyHookOptions.mockClear()
    translateCoreMock.isAbortError.mockReset()
    translateCoreMock.isAbortError.mockReturnValue(false)
    translateCoreMock.formatErrorMessageWithPrefix.mockReset()
    translateCoreMock.formatErrorMessageWithPrefix.mockImplementation((_: unknown, prefix: string) => prefix)
    loggerWarnMock.mockReset()
    loggerErrorMock.mockReset()
    clipboardWriteTextMock.mockReset()
    modelSelectorMock.mockReset()
    languageBarMock.mockReset()
    translateInputPaneMock.mockReset()
    clipboardWriteTextMock.mockResolvedValue(undefined)
    exportContentToNotesMock.mockReset()
    exportContentToNotesMock.mockResolvedValue(undefined)
    pdfViewMock.mockReset()
    pdfHandleMock.cancel.mockReset()
    pdfHandleMock.start.mockReset()
    historyFilesMock.files = {
      source: { entryId: 'entry-source', path: '/tmp/paper.pdf' as AbsoluteFilePath },
      target: { entryId: 'entry-target', path: '/tmp/files/entry-target.pdf' as AbsoluteFilePath }
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    })
    ;(window as any).api = {
      file: {
        readExternal: fileMock.readExternal,
        getPathForFile: fileMock.getPathForFile,
        createTempFile: fileMock.createTempFile,
        write: fileMock.write,
        get: fileMock.get
      },
      fs: {
        readText: fileMock.readText
      }
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('hides the model tag filter on the inline selector', () => {
    render(<TranslatePage />)

    expect(modelSelectorMock).toHaveBeenCalledWith(expect.objectContaining({ showTagFilter: false }))
  })

  it('keeps the input and output panes side by side', () => {
    render(<TranslatePage />)

    const inputSection = screen.getByTestId('translate-input-pane').parentElement
    const outputSection = screen.getByTestId('translate-output-pane').parentElement

    expect(inputSection?.parentElement).toHaveClass('grid-cols-2', 'grid-rows-1')
    expect(outputSection).toHaveClass('border-l')
    expect(outputSection).not.toHaveClass('border-t')
  })

  it('exports the trimmed current translation result to notes using the first translated line as title', async () => {
    MockUseCacheUtils.setCacheValue('translate.output', '\nFirst translated line\nSecond translated line\n')
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.path', '/notes')

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'notes.save' }))

    await waitFor(() =>
      expect(exportContentToNotesMock).toHaveBeenCalledWith(
        'First translated line',
        'First translated line\nSecond translated line',
        '/notes'
      )
    )
  })

  it('logs failures when exporting the current translation result to notes', async () => {
    const exportError = new Error('export failed')
    MockUseCacheUtils.setCacheValue('translate.output', 'First translated line\nSecond translated line')
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.path', '/notes')
    exportContentToNotesMock.mockRejectedValueOnce(exportError)

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'notes.save' }))

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to export output to notes:', exportError)
    })
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

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
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

  it('finishes a selected file read after remount when no newer content operation replaced it', async () => {
    let resolveRead!: (value: string) => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )
    MockUseCacheUtils.setCacheValue('translate.input', 'prefix ')
    MockCacheUtils.setInitialState({ memory: [['translate.input', 'prefix ']] })

    const previousPage = render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))
    previousPage.unmount()

    const currentPage = render(<TranslatePage />)
    await act(async () => resolveRead('file content'))
    currentPage.rerender(<TranslatePage />)

    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('prefix file content')
  })

  it('keeps a remounted history restore ahead of an older file read while persistence is pending', async () => {
    cacheHookMode.realContent = true
    let resolveRead!: (value: string) => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const filePage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
        await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))
        filePage.unmount()

        const historyPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        historyPage.unmount()

        const currentPage = render(<TranslatePage />)
        await act(async () => resolveRead('older file content'))
        await act(async () => resolvePersist())
        currentPage.rerender(<TranslatePage />)

        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('history output')
      }
    )
  })

  it('releases an older file read after a remounted history restore fails', async () => {
    cacheHookMode.realContent = true
    let resolveRead!: (value: string) => void
    let rejectPersist!: () => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )
    MockCacheUtils.setInitialState({ memory: [['translate.input', 'current input']] })
    const persistLanguages = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPersist = () => reject(new Error('save failed'))
        })
    )

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const filePage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
        await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))
        filePage.unmount()

        const historyPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        historyPage.unmount()

        const currentPage = render(<TranslatePage />)
        await act(async () => resolveRead('file content'))
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('current input')

        await act(async () => rejectPersist())
        currentPage.rerender(<TranslatePage />)
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('current inputfile content')
      }
    )
  })

  it('lets a newer file selection win over a pending remounted history restore', async () => {
    cacheHookMode.realContent = true
    let resolveRead!: (value: string) => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )
    MockCacheUtils.setInitialState({ memory: [['translate.input', 'current input']] })
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const historyPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
        await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))
        historyPage.unmount()

        const currentPage = render(<TranslatePage />)
        await act(async () => resolveRead('newer file content'))
        currentPage.rerender(<TranslatePage />)
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('current inputnewer file content')

        await act(async () => resolvePersist())
        currentPage.rerender(<TranslatePage />)
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('current inputnewer file content')
      }
    )
  })

  it('starts a File Processing image_to_text job and appends recognized text from the job snapshot', async () => {
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])

    const { rerender } = render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() =>
      expect(fileMock.startJob).toHaveBeenCalledWith({
        feature: 'image_to_text',
        file: { kind: 'path', path: '/tmp/image.png' }
      })
    )
    expect(toast.loading).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId('translate-input-ocr-processing')).toHaveTextContent('ocr.processing')
    )
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).toBeDisabled())
    expect(fileMock.readText).not.toHaveBeenCalled()

    useJobMock.mockReturnValue({
      data: {
        id: 'job-ocr-1',
        type: 'file-processing.background',
        status: 'completed',
        output: { artifact: { kind: 'text', format: 'plain', text: 'recognized image text' } },
        error: null
      },
      isTerminal: true
    })
    rerender(<TranslatePage />)

    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('recognized image text'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('translate.files.ocr_completed'))
    await waitFor(() => expect(screen.queryByTestId('translate-input-ocr-processing')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).not.toBeDisabled())
    rerender(<TranslatePage />)
    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('recognized image text')
  })

  it('treats a completed OCR job without a text artifact as a failure', async () => {
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])

    const { rerender } = render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(fileMock.startJob).toHaveBeenCalledTimes(1))
    expect(toast.loading).not.toHaveBeenCalled()

    useJobMock.mockReturnValue({
      data: {
        id: 'job-ocr-1',
        type: 'file-processing.background',
        status: 'completed',
        output: { artifact: { kind: 'file', format: 'markdown', path: '/tmp/ocr.md' } },
        error: null
      },
      isTerminal: true
    })
    rerender(<TranslatePage />)

    expect(translateCoreMock.formatErrorMessageWithPrefix).toHaveBeenCalledWith(
      expect.any(Error),
      'translate.files.error.ocr'
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('translate.files.error.ocr'))
    expect(toast.closeToast).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).not.toBeDisabled())
    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('')
  })

  it('locally cancels OCR from the overlay and ignores a later completed snapshot', async () => {
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])

    const { rerender } = render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(fileMock.startJob).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).toBeDisabled())
    expect(screen.getByTestId('translate-input-ocr-processing')).toHaveTextContent('ocr.processing')

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    await waitFor(() => expect(screen.queryByTestId('translate-input-ocr-processing')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).not.toBeDisabled())

    useJobMock.mockReturnValue({
      data: {
        id: 'job-ocr-1',
        type: 'file-processing.background',
        status: 'completed',
        output: { artifact: { kind: 'text', format: 'plain', text: 'late recognized text' } },
        error: null
      },
      isTerminal: true
    })
    rerender(<TranslatePage />)

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('opens selected PDFs in layout-preserving translation mode instead of extracting text', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1'
    })
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() =>
      expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-file-path', '/tmp/input.pdf')
    )
    expect(pdfViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ file: { name: 'input.pdf', path: '/tmp/input.pdf' } })
    )
    expect(fileMock.readExternal).not.toHaveBeenCalled()
    expect(fileMock.startJob).not.toHaveBeenCalled()

    const translateButton = screen.getByRole('button', { name: 'translate.button.translate' })
    await waitFor(() => expect(translateButton).toBeEnabled())
    fireEvent.click(translateButton)

    expect(pdfHandleMock.start).toHaveBeenCalledWith('en-us')
  })

  it('discards PDF view state when a different PDF replaces the selected file', async () => {
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile
      .mockResolvedValueOnce([{ name: 'first.pdf', path: '/tmp/first.pdf', size: 10, type: 'document' }])
      .mockResolvedValueOnce([{ name: 'second.pdf', path: '/tmp/second.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)
    const selectFile = translateInputPaneMock.mock.calls.at(-1)?.[0].onSelectFile as () => Promise<void>

    await act(selectFile)
    await waitFor(() =>
      expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-state-file-path', '/tmp/first.pdf')
    )

    await act(selectFile)
    await waitFor(() =>
      expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-file-path', '/tmp/second.pdf')
    )
    expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-state-file-path', '/tmp/second.pdf')
  })

  it('warns and skips layout-preserving translation when source and target language are the same', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'en-us'
    })
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('available'))
    const translateButton = screen.getByRole('button', { name: 'translate.button.translate' })
    await waitFor(() => expect(translateButton).toBeEnabled())
    fireEvent.click(translateButton)

    // A same-language layout translation is a no-op that still spawns BabelDOC and bills a run —
    // guard it exactly like the text path, so it never reaches the sidecar.
    expect(toast.warning).toHaveBeenCalledWith('translate.language.same')
    expect(pdfHandleMock.start).not.toHaveBeenCalled()
  })

  it('falls back to streamed text translation when BabelDOC is not installed', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    binaryMock.snapshots = {}
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])
    fileMock.readExternal.mockResolvedValue('PDF extracted text')
    translateCoreMock.translateText.mockImplementationOnce(
      async (_text: string, _targetLanguage: string, onResponse?: (text: string, isComplete: boolean) => void) => {
        onResponse?.('streamed translation', false)
        return 'translated text'
      }
    )

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('missing'))
    const translateButton = screen.getByRole('button', { name: 'translate.button.translate' })
    await waitFor(() => expect(translateButton).toBeEnabled())
    fireEvent.click(translateButton)

    await waitFor(() => expect(fileMock.readExternal).toHaveBeenCalledWith('/tmp/input.pdf', true))
    await waitFor(() =>
      expect(translateCoreMock.translateText).toHaveBeenCalledWith(
        'PDF extracted text',
        'zh-cn',
        expect.any(Function),
        expect.any(AbortSignal)
      )
    )
    expect(pdfHandleMock.start).not.toHaveBeenCalled()
    expect(screen.getByTestId('translate-output-content')).toHaveTextContent('streamed translation')

    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.close' }))
    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('')
  })

  it('does not start PDF text fallback translation after closing during language detection', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'auto',
      'feature.translate.page.target_language': 'zh-cn'
    })
    binaryMock.snapshots = {}
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])
    fileMock.readExternal.mockResolvedValue('PDF extracted text')
    let resolveDetection!: (language: string) => void
    translateCoreMock.detectLanguage.mockReturnValue(
      new Promise((resolve) => {
        resolveDetection = resolve
      })
    )

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('missing'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(translateCoreMock.detectLanguage).toHaveBeenCalledWith('PDF extracted text'))

    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.close' }))
    await act(async () => resolveDetection('en-us'))

    expect(translateCoreMock.translateText).not.toHaveBeenCalled()
  })

  it('does not report a PDF extraction failure after the page remounts', async () => {
    let rejectExtraction!: (error: Error) => void
    fileMock.readExternal.mockReturnValueOnce(
      new Promise<string>((_, reject) => {
        rejectExtraction = reject
      })
    )
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
    binaryMock.snapshots = {}
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    const firstPage = render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('missing'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(fileMock.readExternal).toHaveBeenCalledWith('/tmp/input.pdf', true))
    firstPage.unmount()
    render(<TranslatePage />)

    await act(async () => rejectExtraction(new Error('old page extraction failed')))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('installs BabelDOC Stream from the PDF prompt without starting translation', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
    binaryMock.snapshots = {}
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('missing'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.install_babeldoc' }))

    // Pinned even on a first install — `@latest` would resolve against whichever
    // PyPI mirror answers and can land a build older than Cherry's parser needs.
    await waitFor(() =>
      expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
        name: 'babeldoc-stream',
        targetVersion: '0.6.4.post4'
      })
    )
    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('available'))
    expect(pdfHandleMock.start).not.toHaveBeenCalled()
  })

  it('updates an outdated BabelDOC before layout-preserving translation', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
    binaryMock.snapshots = {
      'babeldoc-stream': {
        name: 'babeldoc-stream',
        availability: { source: 'mise', path: '/shims/babeldoc-stream' },
        application: { status: 'applied', version: '0.6.4.post1' }
      }
    }
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('outdated'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.update_babeldoc' }))

    await waitFor(() =>
      expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
        name: 'babeldoc-stream',
        targetVersion: '0.6.4.post4'
      })
    )
  })

  it('keeps text fallback available when inline BabelDOC installation fails', async () => {
    const installError = new Error('install failed')
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    binaryMock.snapshots = {}
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])
    ipcRequestMock.mockImplementation((channel: string) => {
      if (channel === 'binary.get_tool_snapshots') return Promise.resolve(binaryMock.snapshots)
      if (channel === 'binary.install_tool') return Promise.reject(installError)
      return Promise.resolve(undefined)
    })

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('missing'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.install_babeldoc' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.dependencies.installError'))
    expect(screen.getByTestId('babeldoc-availability')).toHaveTextContent('missing')
    await waitFor(() => expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeEnabled())
  })

  it('reports OCR as required when text fallback extracts no content', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.target_language': 'zh-cn'
    })
    binaryMock.snapshots = {}
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'scan.pdf', path: '/tmp/scan.pdf', size: 10, type: 'document' }])
    fileMock.readExternal.mockResolvedValue('  ')

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    const translateButton = screen.getByRole('button', { name: 'translate.button.translate' })
    await waitFor(() => expect(translateButton).toBeEnabled())
    fireEvent.click(translateButton)

    await waitFor(() =>
      expect(pdfViewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ textFallback: expect.objectContaining({ ocrRequired: true }) })
      )
    )
    expect(translateCoreMock.translateText).not.toHaveBeenCalled()
  })

  it('clears extracted PDF text cache when a different PDF is selected', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    binaryMock.snapshots = {}
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile
      .mockResolvedValueOnce([{ name: 'first.pdf', path: '/tmp/first.pdf', size: 10, type: 'document' }])
      .mockResolvedValueOnce([{ name: 'second.pdf', path: '/tmp/second.pdf', size: 10, type: 'document' }])
    fileMock.readExternal.mockImplementation(async (filePath: string) =>
      filePath.includes('first') ? 'first PDF text' : 'second PDF text'
    )

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    const translateButton = screen.getByRole('button', { name: 'translate.button.translate' })
    await waitFor(() => expect(translateButton).toBeEnabled())
    fireEvent.click(translateButton)
    await waitFor(() => expect(fileMock.readExternal).toHaveBeenCalledWith('/tmp/first.pdf', true))

    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.close' }))
    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() =>
      expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-file-path', '/tmp/second.pdf')
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect(fileMock.readExternal).toHaveBeenCalledWith('/tmp/second.pdf', true))
    expect(fileMock.readExternal).toHaveBeenCalledTimes(2)
  })

  it('previews a selected PDF but keeps translation disabled until a model is selected', async () => {
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('pdf-translation-view')).toBeInTheDocument())
    expect(pdfViewMock).toHaveBeenCalledWith(expect.objectContaining({ modelId: undefined }))
    expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeDisabled()
  })

  it('uses explicit language controls and requires a concrete target in PDF mode', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.bidirectional_enabled': true,
      'feature.translate.page.target_language': 'unknown'
    })
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)
    expect(screen.queryByRole('button', { name: 'translate.source_language' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /translate\.target_language/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English ⇆ Chinese' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('pdf-translation-view')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /translate\.source_language/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /translate\.target_language/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeDisabled()
    expect(pdfHandleMock.start).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown', 'zh-cn'],
    ['en-us', 'unknown']
  ])('does not offer language exchange for a non-concrete pair %s to %s', (sourceLanguage, targetLanguage) => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': sourceLanguage,
      'feature.translate.page.target_language': targetLanguage
    })

    render(<TranslatePage />)

    expect(screen.queryByRole('button', { name: 'translate.exchange.label' })).not.toBeInTheDocument()
  })

  it('atomically exchanges the language pair and translated text', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'hello')
    MockUseCacheUtils.setCacheValue('translate.output', '你好')

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.exchange.label' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('en-us')
      expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('你好')
      expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('hello')
    })
  })

  it('blocks language actions while the first exchange is pending', async () => {
    const user = userEvent.setup()
    let exchangeWasDisabled = false
    let resolvePersist!: () => void
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((resolve) => {
          resolvePersist = () => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': values.sourceLanguage,
              'feature.translate.page.target_language': values.targetLanguage
            })
            resolve()
          }
        })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'hello')
    MockUseCacheUtils.setCacheValue('translate.output', '你好')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        const exchangeButton = screen.getByRole('button', { name: 'translate.exchange.label' })
        const sourceChange = languageBarMock.mock.calls.at(-1)?.[0].onSourceChange as (language: string) => void
        const targetChange = languageBarMock.mock.calls.at(-1)?.[0].onTargetChange as (language: string) => void

        await user.click(exchangeButton)
        exchangeWasDisabled = exchangeButton.hasAttribute('disabled')
        await user.click(exchangeButton)
        expect(screen.getByRole('button', { name: /translate\.target_language/ })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeDisabled()

        act(() => sourceChange('ja-jp'))
        act(() => targetChange('en-us'))
        fireEvent.keyDown(screen.getByLabelText('translate.input.placeholder'), { key: 'Enter', ctrlKey: true })

        expect(persistLanguages).toHaveBeenCalledTimes(1)
        expect(translateCoreMock.translateText).not.toHaveBeenCalled()

        await act(async () => resolvePersist())
        rerender(<TranslatePage />)

        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('en-us')
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('你好')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('hello')
      }
    )
    expect(exchangeWasDisabled).toBe(true)
  })

  it('exchanges the latest text when input changes while language persistence is pending', async () => {
    const user = userEvent.setup()
    let resolvePersist!: () => void
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((resolve) => {
          resolvePersist = () => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': values.sourceLanguage,
              'feature.translate.page.target_language': values.targetLanguage
            })
            resolve()
          }
        })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'hello')
    MockUseCacheUtils.setCacheValue('translate.output', '你好')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        await user.click(screen.getByRole('button', { name: 'translate.exchange.label' }))
        expect(persistLanguages).toHaveBeenCalledTimes(1)

        const input = screen.getByLabelText('translate.input.placeholder')
        fireEvent.change(input, { target: { value: 'edited while saving' } })
        rerender(<TranslatePage />)

        await act(async () => resolvePersist())
        rerender(<TranslatePage />)

        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('en-us')
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('你好')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('edited while saving')
      }
    )
  })

  it('ignores history reuse and file selection while language exchange is pending', async () => {
    const user = userEvent.setup()
    const pendingWrites: Array<() => void> = []
    let pendingState: Record<string, unknown> = {}
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((resolve) => {
          pendingWrites.push(() => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': values.sourceLanguage,
              'feature.translate.page.target_language': values.targetLanguage
            })
            resolve()
          })
        })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        await user.click(screen.getByRole('button', { name: 'translate.history.title' }))
        await user.click(screen.getByRole('button', { name: 'translate.exchange.label' }))
        await user.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await user.click(screen.getByRole('button', { name: 'translate.files.upload' }))

        pendingState = {
          input: MockUseCacheUtils.getCacheValue('translate.input'),
          output: MockUseCacheUtils.getCacheValue('translate.output'),
          sourceLanguage: MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language'),
          targetLanguage: MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language'),
          fileSelections: fileMock.onSelectFile.mock.calls.length
        }

        await act(async () => pendingWrites.forEach((complete) => complete()))
        rerender(<TranslatePage />)
      }
    )

    expect(pendingState).toEqual({
      input: 'current input',
      output: 'current output',
      sourceLanguage: 'en-us',
      targetLanguage: 'zh-cn',
      fileSelections: 0
    })
  })

  it('does not let a deferred exchange overwrite text after remount', async () => {
    const user = userEvent.setup()
    let resolvePersist!: () => void
    let remountedText: Record<string, unknown> = {}
    const persistLanguages = vi.fn((values: { sourceLanguage?: string; targetLanguage?: string }) => {
      MockUsePreferenceUtils.setMultiplePreferenceValues({
        'feature.translate.page.source_language': values.sourceLanguage,
        'feature.translate.page.target_language': values.targetLanguage
      })
      return new Promise<void>((resolve) => {
        resolvePersist = resolve
      })
    })
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'old input')
    MockUseCacheUtils.setCacheValue('translate.output', 'old output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'old input'],
        ['translate.output', 'old output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        await user.click(screen.getByRole('button', { name: 'translate.exchange.label' }))
        firstPage.unmount()

        MockUseCacheUtils.setCacheValue('translate.input', 'remounted input')
        MockUseCacheUtils.setCacheValue('translate.output', 'remounted output')
        MockCacheUtils.triggerCacheChange('translate.input', 'remounted input')
        MockCacheUtils.triggerCacheChange('translate.output', 'remounted output')
        const secondPage = render(<TranslatePage />)

        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)
        remountedText = {
          input: MockUseCacheUtils.getCacheValue('translate.input'),
          output: MockUseCacheUtils.getCacheValue('translate.output'),
          sourceLanguage: MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language'),
          targetLanguage: MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')
        }
      }
    )

    expect(remountedText).toEqual({
      input: 'remounted input',
      output: 'remounted output',
      sourceLanguage: 'zh-cn',
      targetLanguage: 'en-us'
    })
  })

  it('completes a deferred exchange after remount when the pane content is unchanged', async () => {
    const user = userEvent.setup()
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'old input')
    MockUseCacheUtils.setCacheValue('translate.output', 'old output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'old input'],
        ['translate.output', 'old output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        await user.click(screen.getByRole('button', { name: 'translate.exchange.label' }))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)

        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('old output')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('old input')
      }
    )

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('en-us')
  })

  it('keeps a remounted history action behind an earlier exchange', async () => {
    const user = userEvent.setup()
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'history input')
    MockUseCacheUtils.setCacheValue('translate.output', 'history output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'history input'],
        ['translate.output', 'history output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const previousPage = render(<TranslatePage />)
        await user.click(screen.getByRole('button', { name: 'translate.exchange.label' }))
        previousPage.unmount()

        const currentPage = render(<TranslatePage />)
        expect(screen.getByRole('button', { name: 'translate.history.title' })).toBeDisabled()
        await act(async () => resolvePersist())
        currentPage.rerender(<TranslatePage />)

        await user.click(screen.getByRole('button', { name: 'translate.history.title' }))
        await user.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await act(async () => resolvePersist())
        currentPage.rerender(<TranslatePage />)

        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('history output')
      }
    )
  })

  it('keeps the language pair and text unchanged when the batch exchange fails', async () => {
    const error = new Error('write failed')
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'hello')
    MockUseCacheUtils.setCacheValue('translate.output', '你好')
    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, vi.fn().mockRejectedValue(error)] as never
      },
      async () => {
        render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.exchange.label' }))

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.save_failed'))
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('en-us')
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('zh-cn')
        expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('hello')
        expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('你好')
      }
    )
  })

  it('filters models that the API gateway cannot route while translating PDFs', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'input.pdf', path: '/tmp/input.pdf', size: 10, type: 'document' }])

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByTestId('pdf-translation-view')).toBeInTheDocument())
    const filter = modelSelectorMock.mock.calls.at(-1)?.[0].filter as (model: {
      capabilities: string[]
      providerId: string
    }) => boolean
    expect(filter({ capabilities: [], providerId: 'corp:west' })).toBe(false)
  })

  it('shows an unavailable error when startJob rejects before an OCR job exists', async () => {
    const ocrError = new Error('Default file processor for image_to_text is not configured')
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])
    fileMock.startJob.mockRejectedValueOnce(ocrError)
    translateCoreMock.formatErrorMessageWithPrefix.mockImplementationOnce((_error: unknown, prefix: string) => {
      return `${prefix}: Default file processor for image_to_text is not configured`
    })

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() =>
      expect(translateCoreMock.formatErrorMessageWithPrefix).toHaveBeenCalledWith(ocrError, 'translate.files.error.ocr')
    )
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'translate.files.error.ocr: Default file processor for image_to_text is not configured'
      )
    )
    expect(toast.loading).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).not.toBeDisabled())
  })

  it('shows an OCR error and unlocks the page when the observed OCR job fails', async () => {
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])

    const { rerender } = render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).toBeDisabled())
    useJobMock.mockReturnValue({
      data: {
        id: 'job-ocr-1',
        type: 'file-processing.background',
        status: 'failed',
        output: null,
        error: { message: 'OCR failed' }
      },
      isTerminal: true
    })
    rerender(<TranslatePage />)

    expect(translateCoreMock.formatErrorMessageWithPrefix).toHaveBeenCalledWith(
      expect.any(Error),
      'translate.files.error.ocr'
    )
    const formattedError = translateCoreMock.formatErrorMessageWithPrefix.mock.calls.at(-1)?.[0] as Error | undefined
    expect(formattedError?.message).toBe('OCR failed')
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('translate.files.error.ocr'))
    expect(toast.closeToast).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).not.toBeDisabled())
  })

  it('surfaces an error and unlocks the page when the OCR job becomes unobservable', async () => {
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])

    const { rerender } = render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).toBeDisabled())
    useJobMock.mockReturnValue({
      data: null,
      isTerminal: false,
      error: new Error('job not found')
    })
    rerender(<TranslatePage />)

    expect(translateCoreMock.formatErrorMessageWithPrefix).toHaveBeenCalledWith(
      expect.any(Error),
      'translate.files.error.ocr'
    )
    const formattedError = translateCoreMock.formatErrorMessageWithPrefix.mock.calls.at(-1)?.[0] as Error | undefined
    expect(formattedError?.message).toBe('job not found')
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('translate.files.error.ocr'))
    await waitFor(() => expect(screen.queryByTestId('translate-input-ocr-processing')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('translate.input.placeholder')).not.toBeDisabled())
  })

  it('starts an image_to_text job for an image dropped onto the input pane', async () => {
    dropMock.getFilesFromDropEvent.mockResolvedValue([{ path: '/tmp/x.png', size: 10, type: 'image' }])

    render(<TranslatePage />)

    fireEvent.drop(screen.getByTestId('translate-input-pane'))

    await waitFor(() =>
      expect(fileMock.startJob).toHaveBeenCalledWith({
        feature: 'image_to_text',
        file: { kind: 'path', path: '/tmp/x.png' }
      })
    )
  })

  it('starts an image_to_text job for a pasted image without a file path', async () => {
    fileMock.getPathForFile.mockReturnValue('')
    fileMock.createTempFile.mockResolvedValue('/tmp/pasted.png')
    fileMock.get.mockResolvedValue({ path: '/tmp/pasted.png', size: 10, type: 'image' })

    render(<TranslatePage />)

    const pastedImage = {
      name: 'pasted.png',
      type: 'image/png',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
    }
    fireEvent.paste(screen.getByLabelText('translate.input.placeholder'), {
      clipboardData: {
        getData: () => '',
        files: [pastedImage]
      }
    })

    await waitFor(() =>
      expect(fileMock.startJob).toHaveBeenCalledWith({
        feature: 'image_to_text',
        file: { kind: 'path', path: '/tmp/pasted.png' }
      })
    )
    // Pasted images have no path → temp-file fallback (createTempFile + write) runs before the job starts.
    expect(fileMock.createTempFile).toHaveBeenCalledWith('pasted.png')
    expect(fileMock.write).toHaveBeenCalled()
  })

  it.each(['canceled picker', 'empty drop', 'file paste with text'])(
    'restores pending history after a %s does not change content',
    async (action) => {
      const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
      MockUseCacheUtils.setCacheValue('translate.input', 'current input')
      MockUseCacheUtils.setCacheValue('translate.output', 'current output')
      fileMock.onSelectFile.mockResolvedValue([])

      await MockUsePreference.useMultiplePreferences.withImplementation(
        (keys) => {
          const values = Object.fromEntries(
            Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
          )
          return [values, persistLanguages] as never
        },
        async () => {
          const { rerender } = render(<TranslatePage />)
          fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
          fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
          await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

          if (action === 'canceled picker') {
            fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
            await waitFor(() => expect(fileMock.onSelectFile).toHaveBeenCalledTimes(1))
          } else if (action === 'empty drop') {
            fireEvent.drop(screen.getByTestId('translate-input-pane'))
            await waitFor(() => expect(dropMock.getFilesFromDropEvent).toHaveBeenCalledTimes(1))
          } else {
            fireEvent.paste(screen.getByLabelText('translate.input.placeholder'), {
              clipboardData: { getData: () => 'clipboard text', files: [{ name: 'image.png' }] }
            })
          }

          await act(async () => resolvePersist())
          rerender(<TranslatePage />)
          expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
          expect(screen.getByTestId('translate-output-content')).toHaveTextContent('history output')
        }
      )
    }
  )

  it('does not show a stale OCR start error after history replaces the input', async () => {
    let rejectStart!: (error: Error) => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])
    fileMock.startJob.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectStart = reject
      })
    )

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(fileMock.startJob).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input'))

    await act(async () => rejectStart(new Error('stale OCR failure')))
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
  })

  it.each(['picker', 'drop text', 'drop files', 'paste'])(
    'does not show a superseded %s ingestion error after history restores the input',
    async (source) => {
      let rejectIngestion!: (error: Error) => void
      const pendingFailure = new Promise((_resolve, reject) => {
        rejectIngestion = reject
      })
      if (source === 'picker') fileMock.onSelectFile.mockReturnValue(pendingFailure)
      if (source === 'drop text') dropMock.getTextFromDropEvent.mockReturnValue(pendingFailure)
      if (source === 'drop files') dropMock.getFilesFromDropEvent.mockReturnValue(pendingFailure)
      if (source === 'paste') {
        fileMock.getPathForFile.mockReturnValue('/tmp/pasted.png')
        fileMock.get.mockReturnValue(pendingFailure)
      }

      render(<TranslatePage />)
      if (source === 'picker') {
        fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
        await waitFor(() => expect(fileMock.onSelectFile).toHaveBeenCalledTimes(1))
      } else if (source === 'paste') {
        fireEvent.paste(screen.getByLabelText('translate.input.placeholder'), {
          clipboardData: { getData: () => '', files: [{ name: 'pasted.png', type: 'image/png' }] }
        })
        await waitFor(() => expect(fileMock.get).toHaveBeenCalledTimes(1))
      } else {
        fireEvent.drop(screen.getByTestId('translate-input-pane'))
        await waitFor(() =>
          expect(
            source === 'drop text' ? dropMock.getTextFromDropEvent : dropMock.getFilesFromDropEvent
          ).toHaveBeenCalled()
        )
      }

      fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
      fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
      await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input'))

      await act(async () => rejectIngestion(new Error('superseded ingestion failure')))
      expect(toast.error).not.toHaveBeenCalled()
      expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
    }
  )

  it('ignores empty text data when handling drops', async () => {
    dropMock.getTextFromDropEvent.mockResolvedValue('')

    render(<TranslatePage />)

    fireEvent.drop(screen.getByTestId('translate-input-pane'))

    await waitFor(() => expect(dropMock.getTextFromDropEvent).toHaveBeenCalled())
    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('')
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

  it('translates to the selected target without blocking on a matching stored source language', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn',
      'feature.translate.page.target_language': 'zh-cn'
    })

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() =>
      expect(translateCoreMock.translateText).toHaveBeenCalledWith(
        'hello',
        'zh-cn',
        expect.any(Function),
        expect.any(AbortSignal)
      )
    )
    expect(toast.warning).not.toHaveBeenCalledWith('translate.language.same')
    await waitFor(() =>
      expect(translateCoreMock.addHistory).toHaveBeenCalledWith({
        sourceText: 'hello',
        targetText: 'translated text',
        sourceLanguage: null,
        targetLanguage: 'zh-cn'
      })
    )
  })

  it('stores single-direction history before detecting and backfills its source language', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'auto',
      'feature.translate.page.target_language': 'en-us'
    })
    translateCoreMock.addHistory.mockResolvedValueOnce({ id: 'history-1' })
    let resolveDetection!: (language: string) => void
    translateCoreMock.detectLanguage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDetection = resolve
      })
    )

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    // The user-visible translation completes while detection is still pending.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('translate.complete'))
    expect(translateCoreMock.addHistory).toHaveBeenCalledWith({
      sourceText: 'hello',
      targetText: 'translated text',
      sourceLanguage: null,
      targetLanguage: 'en-us'
    })
    expect(translateCoreMock.updateHistory).not.toHaveBeenCalled()
    // Backfill must not flip the page into the detecting state.
    expect(screen.getByRole('button', { name: 'translate.button.translate' })).not.toBeDisabled()

    await act(async () => resolveDetection('zh-cn'))

    await waitFor(() =>
      expect(translateCoreMock.updateHistory).toHaveBeenCalledWith('history-1', { sourceLanguage: 'zh-cn' })
    )
    expect(screen.getByRole('button', { name: 'translate.button.translate' })).not.toBeDisabled()
  })

  it.each([
    ['unknown detection', () => Promise.resolve('unknown')],
    ['failed detection', () => Promise.reject(new Error('detect failed'))]
  ])('leaves single-direction history source unset after %s', async (_caseName, detectResult) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
    translateCoreMock.addHistory.mockResolvedValueOnce({ id: 'history-1' })
    translateCoreMock.detectLanguage.mockImplementationOnce(detectResult)

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect(translateCoreMock.detectLanguage).toHaveBeenCalledWith('hello'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(translateCoreMock.updateHistory).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('ignores a deleted history row during source-language backfill', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
    translateCoreMock.addHistory.mockResolvedValueOnce({ id: 'history-deleted' })
    translateCoreMock.updateHistory.mockRejectedValueOnce(new Error('history not found'))

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() =>
      expect(translateCoreMock.updateHistory).toHaveBeenCalledWith('history-deleted', {
        sourceLanguage: 'en-us'
      })
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'translate.button.translate' })).not.toBeDisabled()
    // The mocked hook cannot enforce its own feedback options, so assert the
    // page asks for the silent behavior the backfill relies on.
    expect(translateCoreMock.historyHookOptions).toHaveBeenCalledWith({
      update: { showErrorToast: false, rethrowError: false }
    })
  })

  it('continues translating with the selected target when auto detection returns unknown in bidirectional mode', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'auto',
      'feature.translate.page.target_language': 'en-us',
      'feature.translate.page.bidirectional_enabled': true,
      'feature.translate.page.bidirectional_pair': ['en-us', 'zh-cn']
    })
    translateCoreMock.detectLanguage.mockResolvedValueOnce('unknown')

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() =>
      expect(translateCoreMock.translateText).toHaveBeenCalledWith(
        'hello',
        'en-us',
        expect.any(Function),
        expect.any(AbortSignal)
      )
    )
    expect(toast.warning).not.toHaveBeenCalledWith('translate.language.not_pair')
    await waitFor(() =>
      expect(translateCoreMock.addHistory).toHaveBeenCalledWith({
        sourceText: 'hello',
        targetText: 'translated text',
        sourceLanguage: 'unknown',
        targetLanguage: 'en-us'
      })
    )
  })

  it('detects the source language to choose the opposite bidirectional target', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.bidirectional_enabled': true,
      'feature.translate.page.bidirectional_pair': ['en-us', 'zh-cn']
    })
    translateCoreMock.detectLanguage.mockResolvedValueOnce('zh-cn')

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: '你好' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() =>
      expect(translateCoreMock.translateText).toHaveBeenCalledWith(
        '你好',
        'en-us',
        expect.any(Function),
        expect.any(AbortSignal)
      )
    )
    expect(translateCoreMock.detectLanguage).toHaveBeenCalledWith('你好')
    await waitFor(() =>
      expect(translateCoreMock.addHistory).toHaveBeenCalledWith({
        sourceText: '你好',
        targetText: 'translated text',
        sourceLanguage: 'zh-cn',
        targetLanguage: 'en-us'
      })
    )
  })

  it('does not translate from a language detection that finishes after the page remounts', async () => {
    let resolveDetection!: (language: string) => void
    translateCoreMock.detectLanguage.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDetection = resolve
      })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'auto',
      'feature.translate.page.target_language': 'zh-cn',
      'feature.translate.page.bidirectional_enabled': true
    })

    const user = userEvent.setup()
    const firstPage = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    firstPage.rerender(<TranslatePage />)
    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('hello')
    expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(translateCoreMock.detectLanguage).toHaveBeenCalledWith('hello'))
    firstPage.unmount()
    const secondPage = render(<TranslatePage />)

    await act(async () => resolveDetection('en-us'))
    expect(translateCoreMock.translateText).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()

    secondPage.rerender(<TranslatePage />)
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))
  })

  it('swallows abort errors from translate without showing success-side effects', async () => {
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

    await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
    expect(translateCoreMock.addHistory).not.toHaveBeenCalled()
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

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('translate.error.failed: reason'))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.stop' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.stop' }))

    await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))
    await act(async () => {
      resolveTranslate('done')
    })
  })

  it('aborts in-flight translation on unmount', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    let signal: AbortSignal | undefined
    translateCoreMock.translateText.mockImplementationOnce(
      (_text: string, _targetLanguage: string, _onResponse?: unknown, abortSignal?: AbortSignal) => {
        signal = abortSignal
        return new Promise<string>(() => {})
      }
    )

    const { rerender, unmount } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(signal).toBeDefined())
    unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('cancels in-flight translation when stop is clicked', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    let signal: AbortSignal | undefined
    translateCoreMock.translateText.mockImplementationOnce(
      (_text: string, _targetLanguage: string, _onResponse?: unknown, abortSignal?: AbortSignal) => {
        signal = abortSignal
        return new Promise<string>(() => {})
      }
    )

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.stop' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'common.stop' }))

    expect(signal?.aborted).toBe(true)
    expect(toast.info).toHaveBeenCalledWith('translate.info.aborted')
  })

  it('ignores dropped and pasted files while translation is running', async () => {
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
    dropMock.getFilesFromDropEvent.mockResolvedValue([{ path: '/tmp/replacement.png', size: 10, type: 'image' }])

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.stop' })).toBeInTheDocument())

    fireEvent.drop(screen.getByTestId('translate-input-pane'))
    fireEvent.paste(screen.getByLabelText('translate.input.placeholder'), {
      clipboardData: {
        getData: () => '',
        files: [{ name: 'replacement.png', type: 'image/png' }]
      }
    })

    expect(dropMock.getTextFromDropEvent).not.toHaveBeenCalled()
    expect(dropMock.getFilesFromDropEvent).not.toHaveBeenCalled()
    expect(fileMock.getPathForFile).not.toHaveBeenCalled()

    await act(async () => {
      resolveTranslate('done')
    })
  })

  it('keeps streamed translation text when stop is clicked', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn',
      'feature.translate.page.auto_copy': true
    })
    const abortError = new Error('aborted')
    let signal: AbortSignal | undefined
    translateCoreMock.translateText.mockImplementationOnce(
      (
        _text: string,
        _targetLanguage: string,
        onResponse?: (text: string, isComplete: boolean) => void,
        abortSignal?: AbortSignal
      ) => {
        signal = abortSignal
        onResponse?.('partial text', false)

        return new Promise<string>((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortError), { once: true })
        })
      }
    )
    translateCoreMock.isAbortError.mockImplementation((error: unknown) => error === abortError)

    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    await waitFor(() => expect(screen.getByTestId('translate-output-content')).toHaveTextContent('partial text'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.stop' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.stop' }))

    expect(signal?.aborted).toBe(true)
    await waitFor(() => expect(screen.getByTestId('translate-output-content')).toHaveTextContent('partial text'))
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('partial text')
    expect(toast.info).toHaveBeenCalledWith('translate.info.aborted')
    expect(toast.success).not.toHaveBeenCalled()
    expect(translateCoreMock.addHistory).not.toHaveBeenCalled()
    expect(translateCoreMock.setTimeoutTimer).not.toHaveBeenCalledWith('auto-copy', expect.any(Function), 100)
  })

  it('renders a buffered translation update after the request has settled', async () => {
    const user = userEvent.setup()
    smoothStreamMock.deferUpdates = true
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'hello')
    translateCoreMock.translateText.mockImplementationOnce(
      async (_text: string, _targetLanguage: string, onResponse?: (text: string, isComplete: boolean) => void) => {
        onResponse?.('complete translation', true)
        return 'complete translation'
      }
    )

    const { rerender } = render(<TranslatePage />)
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('translate.complete'))

    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('')
    await act(async () => smoothStreamMock.pendingUpdates.splice(0).forEach((update) => update()))
    rerender(<TranslatePage />)

    expect(screen.getByTestId('translate-output-content')).toHaveTextContent('complete translation')
  })

  it('ignores a buffered translation update after the user edits the input', async () => {
    const user = userEvent.setup()
    smoothStreamMock.deferUpdates = true
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'old input')
    translateCoreMock.translateText.mockImplementationOnce(
      async (_text: string, _targetLanguage: string, onResponse?: (text: string, isComplete: boolean) => void) => {
        onResponse?.('old input translation', true)
        return 'old input translation'
      }
    )

    const { rerender } = render(<TranslatePage />)
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('translate.complete'))

    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'new input' } })
    rerender(<TranslatePage />)
    await act(async () => smoothStreamMock.pendingUpdates.splice(0).forEach((update) => update()))
    rerender(<TranslatePage />)

    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('new input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('')
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

    await waitFor(() =>
      expect(translateCoreMock.addHistory).toHaveBeenCalledWith({
        sourceText: 'hello',
        targetText: 'translated text',
        sourceLanguage: null,
        targetLanguage: 'en-us'
      })
    )
    expect(toast.success).toHaveBeenCalledWith('translate.complete')

    const autoCopyCallback = translateCoreMock.setTimeoutTimer.mock.calls[0]?.[1] as (() => Promise<void>) | undefined
    expect(autoCopyCallback).toBeTypeOf('function')
    await act(async () => {
      await autoCopyCallback?.()
    })

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('translated text')
  })

  it('shows the copied feedback on the input pane rather than the output pane', async () => {
    const { rerender } = render(<TranslatePage />)
    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'hello' } })
    rerender(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'input.copy' }))

    await waitFor(() => expect(screen.getByTestId('translate-input-copied')).toHaveTextContent('true'))
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('hello')
    expect(screen.getByTestId('translate-output-copied')).toHaveTextContent('false')
  })

  it('keeps the current target language when reusing history with a null target language', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.target_language', 'ja-jp')

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-null-target-history' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('ja-jp')
      expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('hello')
      expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('你好')
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('auto')
  })

  it('does not reset the shared source preference when text history has no source language', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.source_language', 'zh-cn')

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-null-target-history' }))

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
  })

  it('keeps the current translation when history language persistence fails', async () => {
    const persistError = new Error('write failed')
    const persistLanguages = vi.fn(async (values: { sourceLanguage?: string; targetLanguage?: string }) => {
      if (values.sourceLanguage && values.targetLanguage) throw persistError
      if (values.sourceLanguage) {
        MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.source_language', values.sourceLanguage)
      }
      if (values.targetLanguage) throw persistError
    })
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.save_failed'))
      }
    )

    expect(persistLanguages).toHaveBeenCalledTimes(1)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('en-us')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('zh-cn')
    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('current input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('current output')
  })

  it('blocks language mutations while history language persistence is pending', async () => {
    const user = userEvent.setup()
    const pendingWrites: Array<() => void> = []
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((resolve) => {
          pendingWrites.push(() => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': values.sourceLanguage,
              'feature.translate.page.target_language': values.targetLanguage
            })
            resolve()
          })
        })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        render(<TranslatePage />)
        const sourceChange = languageBarMock.mock.calls.at(-1)?.[0].onSourceChange as (language: string) => void
        const targetChange = languageBarMock.mock.calls.at(-1)?.[0].onTargetChange as (language: string) => void

        await user.click(screen.getByRole('button', { name: 'translate.history.title' }))
        await user.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        await user.click(screen.getByRole('button', { name: 'translate.exchange.label' }))
        act(() => sourceChange('ja-jp'))
        act(() => targetChange('en-us'))
        const writesWhileHistoryPending = persistLanguages.mock.calls.length

        await act(async () => pendingWrites.forEach((complete) => complete()))
        expect(writesWhileHistoryPending).toBe(1)
      }
    )
  })

  it('does not overwrite newer input after history language persistence completes', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        fireEvent.change(screen.getByLabelText('translate.input.placeholder'), {
          target: { value: 'newer user input' }
        })
        rerender(<TranslatePage />)

        await act(async () => resolvePersist())
        rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('newer user input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('current output')
  })

  it('does not overwrite an ABA input edit after history language persistence completes', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        const input = screen.getByLabelText('translate.input.placeholder')
        fireEvent.change(input, { target: { value: 'temporary edit' } })
        rerender(<TranslatePage />)
        fireEvent.change(input, { target: { value: 'current input' } })
        rerender(<TranslatePage />)

        await act(async () => resolvePersist())
        rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('current input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('current output')
  })

  it('rejects translation while history language persistence is pending and preserves output on failure', async () => {
    const persistError = new Error('write failed')
    let rejectPersist!: () => void
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((_resolve, reject) => {
          MockUsePreferenceUtils.setMultiplePreferenceValues({
            'feature.translate.page.source_language': values.sourceLanguage,
            'feature.translate.page.target_language': values.targetLanguage
          })
          rejectPersist = () => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': 'en-us',
              'feature.translate.page.target_language': 'zh-cn'
            })
            reject(persistError)
          }
        })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        rerender(<TranslatePage />)

        expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeDisabled()
        fireEvent.keyDown(screen.getByLabelText('translate.input.placeholder'), { key: 'Enter', ctrlKey: true })
        expect(translateCoreMock.translateText).not.toHaveBeenCalled()

        await act(async () => rejectPersist())
        rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('current output')
  })

  it('keeps an in-flight translation when history language persistence fails', async () => {
    const persistError = new Error('write failed')
    let emitResponse!: (text: string, isComplete: boolean) => void
    let resolveTranslate!: (value: string) => void
    let rejectPersist!: () => void
    translateCoreMock.translateText.mockImplementationOnce(
      (_text: string, _targetLanguage: string, onResponse?: (text: string, isComplete: boolean) => void) => {
        emitResponse = onResponse ?? (() => undefined)
        return new Promise<string>((resolve) => {
          resolveTranslate = resolve
        })
      }
    )
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((_resolve, reject) => {
          MockUsePreferenceUtils.setMultiplePreferenceValues({
            'feature.translate.page.source_language': values.sourceLanguage,
            'feature.translate.page.target_language': values.targetLanguage
          })
          rejectPersist = () => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': 'en-us',
              'feature.translate.page.target_language': 'zh-cn'
            })
            reject(persistError)
          }
        })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
        await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        await act(async () => {
          emitResponse('completed translation', true)
          resolveTranslate('completed translation')
        })
        const input = screen.getByLabelText('translate.input.placeholder')
        fireEvent.change(input, { target: { value: 'newer input' } })
        rerender(<TranslatePage />)
        await act(async () => rejectPersist())
        rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('newer input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('completed translation')
    expect(toast.success).toHaveBeenCalledWith('translate.complete')
    expect(translateCoreMock.addHistory).toHaveBeenCalledWith({
      sourceText: 'current input',
      targetText: 'completed translation',
      sourceLanguage: null,
      targetLanguage: 'zh-cn'
    })
  })

  it('completes text-history restoration after remount when cached panes are unchanged', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)

        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('history output')
      }
    )
  })

  it.each(['resolved', 'rejected'])(
    'keeps remounted language controls disabled until history persistence is %s',
    async (outcome) => {
      let settle!: () => void
      const persistLanguages = vi.fn(
        (values: { sourceLanguage?: string; targetLanguage?: string }) =>
          new Promise<void>((resolve, reject) => {
            settle = () => {
              if (outcome === 'rejected') {
                reject(new Error('save failed'))
              } else {
                MockUsePreferenceUtils.setMultiplePreferenceValues({
                  'feature.translate.page.source_language': values.sourceLanguage,
                  'feature.translate.page.target_language': values.targetLanguage
                })
                resolve()
              }
            }
          })
      )
      MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
      MockUseCacheUtils.setCacheValue('translate.input', 'current input')
      MockCacheUtils.setInitialState({ memory: [['translate.input', 'current input']] })

      await MockUsePreference.useMultiplePreferences.withImplementation(
        (keys) => {
          const values = Object.fromEntries(
            Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
          )
          return [values, persistLanguages] as never
        },
        async () => {
          const firstPage = render(<TranslatePage />)
          fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
          fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
          await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
          firstPage.unmount()

          const secondPage = render(<TranslatePage />)
          const targetControl = screen.getByRole('button', { name: /translate\.target_language/ })
          expect(targetControl).toBeDisabled()
          expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeDisabled()

          await act(async () => settle())
          secondPage.rerender(<TranslatePage />)
          await waitFor(() => expect(targetControl).not.toBeDisabled())
          expect(screen.getByRole('button', { name: 'translate.button.translate' })).not.toBeDisabled()
        }
      )
    }
  )

  it('blocks the keyboard shortcut while remounted history persistence is pending', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4.1')
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        fireEvent.keyDown(screen.getByLabelText('translate.input.placeholder'), { key: 'Enter', ctrlKey: true })
        expect(translateCoreMock.translateText).not.toHaveBeenCalled()
        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)

        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('history output')
      }
    )
  })

  it('keeps remounted history panes aligned with the last persisted language pair', async () => {
    const pending: Array<() => void> = []
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': values.sourceLanguage,
              'feature.translate.page.target_language': values.targetLanguage
            })
            resolve()
          })
        })
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-other-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(2))

        await act(async () => pending[0]())
        secondPage.rerender(<TranslatePage />)
        expect(screen.getByRole('button', { name: /translate\.target_language/ })).toBeDisabled()
        await act(async () => pending[1]())
        secondPage.rerender(<TranslatePage />)
        expect(screen.getByRole('button', { name: /translate\.target_language/ })).not.toBeDisabled()

        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('ja-jp')
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('newer history input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('newer history output')

        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(3))
        fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'manual edit' } })
        await act(async () => pending[2]())
        secondPage.rerender(<TranslatePage />)

        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('manual edit')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('newer history output')
      }
    )
  })

  it('preserves remounted panes changed before text-history persistence completes', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        MockUseCacheUtils.setCacheValue('translate.input', 'remounted input')
        MockUseCacheUtils.setCacheValue('translate.output', 'remounted output')
        MockCacheUtils.triggerCacheChange('translate.input', 'remounted input')
        MockCacheUtils.triggerCacheChange('translate.output', 'remounted output')
        const secondPage = render(<TranslatePage />)
        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)

        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('remounted input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('remounted output')
      }
    )
  })

  it('starts translation after a remounted history restore settles without replacing newer input', async () => {
    let emitResponse!: (text: string, isComplete: boolean) => void
    let resolveTranslate!: (value: string) => void
    translateCoreMock.translateText.mockImplementationOnce(
      (_text: string, _targetLanguage: string, onResponse?: (text: string, isComplete: boolean) => void) => {
        emitResponse = onResponse ?? (() => undefined)
        return new Promise<string>((resolve) => {
          resolveTranslate = resolve
        })
      }
    )
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        fireEvent.change(screen.getByLabelText('translate.input.placeholder'), { target: { value: 'new input' } })
        expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeDisabled()
        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
        await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))

        await act(async () => {
          emitResponse('new translation', true)
          resolveTranslate('new translation')
        })
        secondPage.rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('new input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('new translation')
    expect(toast.success).toHaveBeenCalledWith('translate.complete')
  })

  it('restores history when an older translation completes during language persistence', async () => {
    let emitResponse!: (text: string, isComplete: boolean) => void
    let resolveTranslate!: (value: string) => void
    translateCoreMock.translateText.mockImplementationOnce(
      (_text: string, _targetLanguage: string, onResponse?: (text: string, isComplete: boolean) => void) => {
        emitResponse = onResponse ?? (() => undefined)
        return new Promise<string>((resolve) => {
          resolveTranslate = resolve
        })
      }
    )
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
        await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        await act(async () => {
          emitResponse('older translation', true)
          resolveTranslate('older translation')
        })
        await act(async () => resolvePersist())
        rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('history output')
    expect(toast.success).not.toHaveBeenCalledWith('translate.complete')
    expect(translateCoreMock.addHistory).not.toHaveBeenCalled()
  })

  it('restores history when older language detection completes during language persistence', async () => {
    let resolveDetection!: (value: string) => void
    translateCoreMock.detectLanguage.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDetection = resolve
      })
    )
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'auto',
      'feature.translate.page.target_language': 'en-us',
      'feature.translate.page.bidirectional_enabled': true
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
        await waitFor(() => expect(translateCoreMock.detectLanguage).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        await act(async () => resolveDetection('zh-cn'))
        await act(async () => resolvePersist())
        rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('history output')
  })

  it('restores history when an older file read completes during language persistence', async () => {
    let resolveRead!: (value: string) => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
        await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))

        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        await act(async () => resolveRead('older file content'))
        await act(async () => resolvePersist())
        rerender(<TranslatePage />)
      }
    )

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('history output')
  })

  it('ignores a translation response that completes after history restoration', async () => {
    let emitResponse!: (text: string, isComplete: boolean) => void
    let resolveTranslate!: (value: string) => void
    translateCoreMock.translateText.mockImplementationOnce(
      (_text: string, _targetLanguage: string, onResponse?: (text: string, isComplete: boolean) => void) => {
        emitResponse = onResponse ?? (() => undefined)
        return new Promise<string>((resolve) => {
          resolveTranslate = resolve
        })
      }
    )
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.model_id': 'openai::gpt-4.1',
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')

    const { rerender } = render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await waitFor(() => expect(translateCoreMock.translateText).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('history output'))

    await act(async () => {
      emitResponse('late translation', false)
      resolveTranslate('late translation')
    })
    rerender(<TranslatePage />)

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('history output')
  })

  it('ignores a file read that completes after history restoration', async () => {
    let resolveRead!: (value: string) => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )

    const { rerender } = render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input'))

    await act(async () => resolveRead('late file content'))
    rerender(<TranslatePage />)

    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('history output')
  })

  it('does not report a failed file read after history replaces its input', async () => {
    let rejectRead!: (error: Error) => void
    vi.mocked(toast.loading).mockReturnValueOnce('stale-file-toast')
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        rejectRead = reject
      })
    )

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input'))

    await act(async () => rejectRead(new Error('stale read failure')))

    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.closeToast).toHaveBeenCalledWith('stale-file-toast')
    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input')
  })

  it('ignores a file read from an unmounted page after history is restored on a new page', async () => {
    const user = userEvent.setup()
    let resolveRead!: (value: string) => void
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )

    const previousPage = render(<TranslatePage />)
    await user.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))
    previousPage.unmount()

    const currentPage = render(<TranslatePage />)
    await user.click(screen.getByRole('button', { name: 'translate.history.title' }))
    await user.click(screen.getByRole('button', { name: 'reuse-text-history' }))
    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input'))

    await act(async () => resolveRead('late file content'))
    currentPage.rerender(<TranslatePage />)

    expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('history input')
    expect(screen.getByTestId('translate-output-content')).toHaveTextContent('history output')
  })

  it('ignores OCR output that completes after history restoration', async () => {
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/image.png', size: 10, type: 'image' }])

    const { rerender } = render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() => expect(fileMock.startJob).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input'))

    useJobMock.mockReturnValue({
      data: {
        id: 'job-ocr-1',
        type: 'file-processing.background',
        status: 'completed',
        output: { artifact: { kind: 'text', format: 'plain', text: 'late recognized text' } },
        error: null
      },
      isTerminal: true
    })
    rerender(<TranslatePage />)

    await waitFor(() => expect(screen.queryByTestId('translate-input-ocr-processing')).not.toBeInTheDocument())
    expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('history input')
    expect(MockUseCacheUtils.getCacheValue('translate.output')).toBe('history output')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('does not replace a newer PDF selection after history language persistence completes', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ name: 'newer.pdf', path: '/tmp/newer.pdf', size: 10, type: 'document' }])

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const { rerender } = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
        await waitFor(() => {
          expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-file-path', '/tmp/newer.pdf')
        })

        await act(async () => resolvePersist())
        rerender(<TranslatePage />)
      }
    )

    expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-file-path', '/tmp/newer.pdf')
  })

  it('falls back to a concrete target language when reusing history with a null target and current unknown target', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.target_language', 'unknown')

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-null-target-history' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('en-us')
    })
  })

  it('restores the side-by-side preview when reusing a PDF history entry', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.source_language', 'zh-cn')

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-pdf-history' }))

    const view = await screen.findByTestId('pdf-translation-view')
    expect(view).toHaveAttribute('data-file-path', '/tmp/paper.pdf')
    expect(view).toHaveAttribute('data-restored-output', '/tmp/files/entry-target.pdf')
    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('auto')
    })
    // A PDF row's texts are file names — they must not land in the text panes.
    expect(MockUseCacheUtils.getCacheValue('translate.input')).not.toBe('paper.pdf')
  })

  it('restores a pending PDF history preview after remount with its persisted language pair', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUseCacheUtils.setCacheValue('translate.input', '')
    MockUseCacheUtils.setCacheValue('translate.output', '')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', ''],
        ['translate.output', '']
      ]
    })
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.page.source_language': 'en-us',
      'feature.translate.page.target_language': 'zh-cn'
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-pdf-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)

        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('auto')
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('zh-cn')
        const view = await screen.findByTestId('pdf-translation-view')
        expect(view).toHaveAttribute('data-file-path', '/tmp/paper.pdf')
        expect(view).toHaveAttribute('data-restored-output', '/tmp/files/entry-target.pdf')
      }
    )
  })

  it('does not reopen an earlier PDF after two unmounted history restores settle', async () => {
    const pending: Array<() => void> = []
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': values.sourceLanguage,
              'feature.translate.page.target_language': values.targetLanguage
            })
            resolve()
          })
        })
    )
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-pdf-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-other-text-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(2))
        secondPage.unmount()

        await act(async () => pending[0]())
        await act(async () => pending[1]())
        render(<TranslatePage />)

        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('ja-jp')
        expect(screen.queryByTestId('pdf-translation-view')).toBeNull()
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('newer history input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('newer history output')
      }
    )
  })

  it('keeps the last persisted PDF preview and language pair after overlapping remount restores', async () => {
    const pending: Array<() => void> = []
    const persistLanguages = vi.fn(
      (values: { sourceLanguage?: string; targetLanguage?: string }) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            MockUsePreferenceUtils.setMultiplePreferenceValues({
              'feature.translate.page.source_language': values.sourceLanguage,
              'feature.translate.page.target_language': values.targetLanguage
            })
            resolve()
          })
        })
    )
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-pdf-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        const secondPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-other-pdf-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(2))

        await act(async () => pending[0]())
        await act(async () => pending[1]())
        secondPage.rerender(<TranslatePage />)

        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.source_language')).toBe('zh-cn')
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.page.target_language')).toBe('ja-jp')
        const view = await screen.findByTestId('pdf-translation-view')
        expect(view).toHaveAttribute('data-file-path', '/tmp/other.pdf')
        expect(view).toHaveAttribute('data-restored-output', '/tmp/files/entry-other-target.pdf')
      }
    )
  })

  it('does not restore an older PDF history over panes changed after remount', async () => {
    const { persistLanguages, resolvePersist } = createDeferredLanguagePersist()
    MockUseCacheUtils.setCacheValue('translate.input', 'current input')
    MockUseCacheUtils.setCacheValue('translate.output', 'current output')
    MockCacheUtils.setInitialState({
      memory: [
        ['translate.input', 'current input'],
        ['translate.output', 'current output']
      ]
    })

    await MockUsePreference.useMultiplePreferences.withImplementation(
      (keys) => {
        const values = Object.fromEntries(
          Object.entries(keys).map(([alias, key]) => [alias, MockUsePreferenceUtils.getPreferenceValue(key)])
        )
        return [values, persistLanguages] as never
      },
      async () => {
        const firstPage = render(<TranslatePage />)
        fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
        fireEvent.click(screen.getByRole('button', { name: 'reuse-pdf-history' }))
        await waitFor(() => expect(persistLanguages).toHaveBeenCalledTimes(1))
        firstPage.unmount()

        MockUseCacheUtils.setCacheValue('translate.input', 'remounted input')
        MockUseCacheUtils.setCacheValue('translate.output', 'remounted output')
        MockCacheUtils.triggerCacheChange('translate.input', 'remounted input')
        MockCacheUtils.triggerCacheChange('translate.output', 'remounted output')
        const secondPage = render(<TranslatePage />)
        await act(async () => resolvePersist())
        secondPage.rerender(<TranslatePage />)

        expect(screen.queryByTestId('pdf-translation-view')).toBeNull()
        expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('remounted input')
        expect(screen.getByTestId('translate-output-content')).toHaveTextContent('remounted output')
      }
    )
  })

  it('reports a PDF history entry whose files are gone instead of opening an empty preview', async () => {
    historyFilesMock.files = { source: null, target: null }

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-pdf-history' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('translate.history.file.unavailable'))
    expect(screen.queryByTestId('pdf-translation-view')).toBeNull()
  })

  it('keeps the current PDF open when a history entry is only partially available', async () => {
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([
      { name: 'current.pdf', path: '/tmp/current.pdf', size: 10, type: 'document' }
    ])
    historyFilesMock.files = {
      source: null,
      target: { entryId: 'entry-target', path: '/tmp/files/entry-target.pdf' as AbsoluteFilePath }
    }

    render(<TranslatePage />)
    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))
    await waitFor(() =>
      expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-file-path', '/tmp/current.pdf')
    )

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'reuse-pdf-history' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('translate.history.file.unavailable'))
    expect(screen.getByTestId('pdf-translation-view')).toHaveAttribute('data-file-path', '/tmp/current.pdf')
  })

  it('keeps history and settings drawers mutually exclusive and exposes open state through aria-pressed', () => {
    render(<TranslatePage />)
    const historyButton = screen.getByRole('button', { name: 'translate.history.title' })
    const settingsButton = screen.getByRole('button', { name: 'translate.settings.title' })

    expect(historyButton).toHaveAttribute('aria-pressed', 'false')
    expect(settingsButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('translate-history-open')).toBeNull()
    expect(screen.queryByTestId('translate-settings-open')).toBeNull()

    fireEvent.click(historyButton)
    expect(historyButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('translate-history-open')).toBeInTheDocument()

    fireEvent.click(settingsButton)
    expect(settingsButton).toHaveAttribute('aria-pressed', 'true')
    expect(historyButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('translate-history-open')).toBeNull()
    expect(screen.getByTestId('translate-settings-open')).toBeInTheDocument()

    fireEvent.click(historyButton)
    expect(historyButton).toHaveAttribute('aria-pressed', 'true')
    expect(settingsButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('translate-history-open')).toBeInTheDocument()
    expect(screen.queryByTestId('translate-settings-open')).toBeNull()

    fireEvent.click(historyButton)
    expect(historyButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('translate-history-open')).toBeNull()
  })
})
