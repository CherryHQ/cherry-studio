import type * as TranslateHooks from '@renderer/hooks/translate'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const uuidMock = vi.hoisted(() => vi.fn(() => 'abort-key'))
const ipcRequestMock = vi.hoisted(() => vi.fn())

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
  isAbortError: vi.fn(),
  formatErrorMessageWithPrefix: vi.fn((_: unknown, prefix: string) => prefix)
}))
const loggerWarnMock = vi.hoisted(() => vi.fn())
const clipboardWriteTextMock = vi.hoisted(() => vi.fn())
const toastLoadingMock = vi.hoisted(() => vi.fn())
const toastCloseToastMock = vi.hoisted(() => vi.fn())
const modelSelectorMock = vi.hoisted(() => vi.fn())

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

vi.mock('@renderer/components/Selector/model', () => ({
  ModelSelector: (props: { trigger: React.ReactNode }) => {
    modelSelectorMock(props)
    return <>{props.trigger}</>
  }
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    shikiMarkdownIt: vi.fn().mockResolvedValue('')
  })
}))

vi.mock('@renderer/hooks/translate', async (importOriginal) => ({
  ...(await importOriginal<typeof TranslateHooks>()),
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

vi.mock('@renderer/hooks/useJob', () => ({
  useJob: useJobMock
}))

vi.mock('@renderer/hooks/useModel', () => ({
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

vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: () => [false, vi.fn()]
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: translateCoreMock.setTimeoutTimer })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
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

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  getFileExtension: fileMock.getFileExtension,
  isTextFile: fileMock.isTextFile,
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

vi.mock('@renderer/utils/translate', () => ({
  createInputScrollHandler: () => vi.fn(),
  createOutputScrollHandler: () => vi.fn(),
  determineTargetLanguage: translateCoreMock.determineTargetLanguage,
  translateText: translateCoreMock.translateText,
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
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="translate-history-open" /> : null)
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
    disabled?: boolean
    ocrProcessing?: boolean
  }) => (
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
}))

vi.mock('../components/TranslateLanguageBar', () => ({
  default: () => null
}))

vi.mock('../components/TranslateOutputPane', () => ({
  default: ({ translating }: { translating: boolean }) => (
    <div data-testid="translate-output-pane">{translating && <span>translate.processing</span>}</div>
  )
}))

vi.mock('../TranslateSettings', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid="translate-settings-open" /> : null)
}))

import TranslatePage from '../TranslatePage'

describe('TranslatePage', () => {
  beforeEach(() => {
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
    ipcRequestMock.mockImplementation((channel: string, payload?: unknown) =>
      channel === 'file_processing.start_job' ? fileMock.startJob(payload) : Promise.resolve(undefined)
    )
    fileMock.readExternal.mockResolvedValue('document content')
    uuidMock.mockReset()
    uuidMock.mockReturnValue('abort-key')
    useJobMock.mockReset()
    useJobMock.mockReturnValue({ data: undefined, isTerminal: false })
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
    translateCoreMock.isAbortError.mockReset()
    translateCoreMock.isAbortError.mockReturnValue(false)
    translateCoreMock.formatErrorMessageWithPrefix.mockReset()
    translateCoreMock.formatErrorMessageWithPrefix.mockImplementation((_: unknown, prefix: string) => prefix)
    loggerWarnMock.mockReset()
    clipboardWriteTextMock.mockReset()
    modelSelectorMock.mockReset()
    clipboardWriteTextMock.mockResolvedValue(undefined)
    toastLoadingMock.mockReset()
    toastCloseToastMock.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    })
    ;(window as any).toast = {
      closeToast: toastCloseToastMock,
      error: vi.fn(),
      info: vi.fn(),
      loading: toastLoadingMock,
      success: vi.fn(),
      warning: vi.fn()
    }
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
    expect(toastLoadingMock).not.toHaveBeenCalled()
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
    await waitFor(() => expect((window as any).toast.success).toHaveBeenCalledWith('translate.files.ocr_completed'))
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
    expect(toastLoadingMock).not.toHaveBeenCalled()

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
    await waitFor(() => expect((window as any).toast.error).toHaveBeenCalledWith('translate.files.error.ocr'))
    expect(toastCloseToastMock).not.toHaveBeenCalled()
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
    expect((window as any).toast.success).not.toHaveBeenCalled()
  })

  it('uses readExternal for selected document files', async () => {
    fileMock.getFileExtension.mockReturnValue('.pdf')
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.pdf', size: 10, type: 'document' }])
    fileMock.readExternal.mockResolvedValueOnce('pdf content')

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    await waitFor(() => expect(fileMock.readExternal).toHaveBeenCalledWith('/tmp/input.pdf', true))
    expect(fileMock.startJob).not.toHaveBeenCalled()
    await waitFor(() => expect(MockUseCacheUtils.getCacheValue('translate.input')).toBe('pdf content'))
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
      expect((window as any).toast.error).toHaveBeenCalledWith(
        'translate.files.error.ocr: Default file processor for image_to_text is not configured'
      )
    )
    expect(toastLoadingMock).not.toHaveBeenCalled()
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
    await waitFor(() => expect((window as any).toast.error).toHaveBeenCalledWith('translate.files.error.ocr'))
    expect(toastCloseToastMock).not.toHaveBeenCalled()
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
    await waitFor(() => expect((window as any).toast.error).toHaveBeenCalledWith('translate.files.error.ocr'))
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
    expect((window as any).toast.success).not.toHaveBeenCalled()
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

    await waitFor(() => expect((window as any).toast.error).toHaveBeenCalledWith('translate.error.failed: reason'))
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
    expect((window as any).toast.info).toHaveBeenCalledWith('translate.info.aborted')
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
        sourceLanguage: 'zh-cn',
        targetLanguage: 'zh-cn'
      })
    )
    expect((window as any).toast.success).toHaveBeenCalledWith('translate.complete')

    const autoCopyCallback = translateCoreMock.setTimeoutTimer.mock.calls[0]?.[1] as (() => Promise<void>) | undefined
    expect(autoCopyCallback).toBeTypeOf('function')
    await act(async () => {
      await autoCopyCallback?.()
    })

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('translated text')
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
