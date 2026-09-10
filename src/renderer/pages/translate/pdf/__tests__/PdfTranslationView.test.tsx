import { IpcError } from '@shared/ipc/errors/IpcError'
import { translateErrorCodes } from '@shared/ipc/errors/translate'
import type { PdfTranslationProgress } from '@shared/ipc/schemas/translate'
import type { AbsoluteFilePath } from '@shared/types/file'
import { mockUseInvalidateCache } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PdfTranslationView, { type PdfTranslationHandle } from '../PdfTranslationView'

const PAPER_PATH = '/tmp/paper.pdf' as AbsoluteFilePath
const SCAN_PATH = '/tmp/scan.pdf' as AbsoluteFilePath

const mocks = vi.hoisted(() => ({
  invalidateCache: vi.fn(),
  ipcRequest: vi.fn(),
  progressHandler: null as null | ((payload: PdfTranslationProgress & { jobId: string }) => void),
  stageHandler: null as
    | null
    | ((payload: { jobId: string; stage: 'preparing' | 'downloading_assets' | 'translating' }) => void),
  uuid: vi.fn(() => 'b289bad7-a813-4cf7-91c0-2a9dc82235b2')
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (event: string, handler: unknown) => {
    if (event === 'translate.pdf.stage') mocks.stageHandler = handler as typeof mocks.stageHandler
    if (event === 'translate.pdf.progress') mocks.progressHandler = handler as typeof mocks.progressHandler
  }
}))
vi.mock('@renderer/utils/uuid', () => ({ uuid: mocks.uuid }))
vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: ({ filePath }: { filePath: string }) => <div data-testid="pdf-preview" data-file-path={filePath} />
}))

const onJobChange = vi.fn()

describe('PdfTranslationView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invalidateCache.mockResolvedValue(undefined)
    mockUseInvalidateCache.mockReturnValue(mocks.invalidateCache)
    mocks.progressHandler = null
    mocks.stageHandler = null
  })

  it('translates through IpcApi and previews the translated PDF beside the source', async () => {
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'translate.pdf.start') {
        return { fileName: 'paper.zh-CN.mono.pdf', outputPath: '/tmp/job/paper.zh-CN.mono.pdf' }
      }
      return undefined
    })
    let handle: PdfTranslationHandle | null = null
    const onStatusChange = vi.fn()

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={onStatusChange}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText('paper.pdf')).toBeInTheDocument()
    expect(screen.getByText('translate.pdf.pane.translated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'translate.pdf.action.close' })).toBeInTheDocument()
    expect(screen.getByTestId('pdf-preview')).toHaveAttribute('data-file-path', '/tmp/paper.pdf')

    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('translate.pdf.start', {
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        modelId: 'openai::gpt-4.1',
        sourceLangCode: 'en-us',
        sourcePath: '/tmp/paper.pdf',
        targetLangCode: 'zh-cn'
      })
    )
    await waitFor(() => expect(screen.getAllByTestId('pdf-preview')).toHaveLength(2))
    expect(screen.getAllByTestId('pdf-preview')[1]).toHaveAttribute('data-file-path', '/tmp/job/paper.zh-CN.mono.pdf')
    expect(onStatusChange).toHaveBeenLastCalledWith({ phase: 'success', running: false })
    expect(mocks.invalidateCache).toHaveBeenCalledWith('/translate/histories')
  })

  it('shows stable streamed progress for the active PDF translation job', async () => {
    let resolveStart!: (result: { fileName: string; outputPath: string }) => void
    const startPromise = new Promise<{ fileName: string; outputPath: string }>((resolve) => {
      resolveStart = resolve
    })
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') return startPromise
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))
    await waitFor(() => expect(mocks.progressHandler).not.toBeNull())
    expect(screen.getByText('translate.pdf.progress.preparing')).toBeInTheDocument()
    expect(screen.getByText('translate.pdf.progress.preparing_hint')).toBeInTheDocument()

    act(() => {
      mocks.progressHandler?.({
        jobId: 'another-job',
        stage: 'translating',
        stageProgress: 80,
        overallProgress: 80
      })
    })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'checking_assets',
        stageProgress: 50,
        overallProgress: 1
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.checking_assets' })).toHaveAttribute(
      'aria-valuenow',
      '50'
    )
    expect(screen.queryByText('translate.pdf.progress.preparing_hint')).not.toBeInTheDocument()

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'downloading_assets',
        stageProgress: 42.3,
        overallProgress: 2.1
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.downloading_assets' })).toHaveAttribute(
      'aria-valuenow',
      '42'
    )

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'parsing',
        stageProgress: 50,
        overallProgress: 10
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.parsing' })).toHaveAttribute(
      'aria-valuenow',
      '10'
    )
    expect(screen.queryByText('translate.pdf.progress.details')).not.toBeInTheDocument()

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'analyzing',
        stageProgress: 25,
        overallProgress: 30
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.analyzing' })).toHaveAttribute(
      'aria-valuenow',
      '30'
    )

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'extracting_terms',
        stageProgress: 60,
        overallProgress: 35
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.extracting_terms' })).toHaveAttribute(
      'aria-valuenow',
      '35'
    )

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'translating',
        stageProgress: 18,
        overallProgress: 42
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.translating' })).toHaveAttribute(
      'aria-valuenow',
      '42'
    )

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'typesetting',
        stageProgress: 40,
        overallProgress: 70
      })
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'parsing',
        stageProgress: 90,
        overallProgress: 60
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.typesetting' })).toHaveAttribute(
      'aria-valuenow',
      '70'
    )
    expect(screen.getByTestId('circular-progress')).toHaveAttribute('data-value', '70')

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'rendering',
        stageProgress: 90,
        overallProgress: 90
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.rendering' })).toHaveAttribute(
      'aria-valuenow',
      '90'
    )

    resolveStart({ fileName: 'paper.zh-CN.mono.pdf', outputPath: '/tmp/job/paper.zh-CN.mono.pdf' })
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  })

  it('shows indeterminate PDF stages without a misleading percentage', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') return new Promise(() => {})
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))
    await waitFor(() => expect(mocks.progressHandler).not.toBeNull())

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'loading_model',
        stageProgress: null,
        overallProgress: 4.5
      })
    })

    expect(screen.getByText('translate.pdf.progress.loading_model')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('leaves a running job alone on unmount, and reports it so the tab can end it', async () => {
    let resolveStart!: (result: { fileName: string; outputPath: string }) => void
    const startPromise = new Promise<{ fileName: string; outputPath: string }>((resolve) => {
      resolveStart = resolve
    })
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') return startPromise
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null
    const { unmount } = render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('translate.pdf.start', expect.anything()))

    // Hiding a tab tears this view's effects down and hibernating one unmounts it outright;
    // neither should end a translation the user started (#20114). The job id went to the session,
    // which is what ends it when the tab does.
    expect(onJobChange).toHaveBeenCalledWith('b289bad7-a813-4cf7-91c0-2a9dc82235b2')

    unmount()
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('translate.pdf.cancel', expect.anything())

    resolveStart({ fileName: 'paper.zh-CN.pdf', outputPath: '/tmp/files/entry-1.pdf' })
    // A run that finishes after unmount already recorded itself in history and handed its
    // PDF to FileManager, so there is nothing left for the renderer to clean up.
    await waitFor(() => expect(mocks.invalidateCache).toHaveBeenCalledWith('/translate/histories'))
  })

  it('mounts straight into the side-by-side result when reopened from history', () => {
    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        restoredOutput={{ fileName: 'paper.zh-CN.pdf', outputPath: '/tmp/files/entry-1.pdf' as AbsoluteFilePath }}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={vi.fn()}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )

    const previews = screen.getAllByTestId('pdf-preview')
    expect(previews).toHaveLength(2)
    expect(previews[1]).toHaveAttribute('data-file-path', '/tmp/files/entry-1.pdf')
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('offers inline installation when the PDF runtime reports that BabelDOC is unavailable', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') {
        return Promise.reject(
          new IpcError(translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED, 'BabelDOC Stream is not installed')
        )
      }
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null
    const onInstallBabelDoc = vi.fn()
    const onBabelDocUnavailable = vi.fn()

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={onInstallBabelDoc}
        onBabelDocUnavailable={onBabelDocUnavailable}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))

    expect(await screen.findByText('translate.pdf.dependency.title')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.install_babeldoc' }))

    expect(onBabelDocUnavailable).toHaveBeenCalledOnce()
    expect(onInstallBabelDoc).toHaveBeenCalledOnce()
  })

  it('explains when an image-only PDF requires OCR', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') {
        return Promise.reject(new IpcError(translateErrorCodes.PDF_OCR_REQUIRED, 'OCR required'))
      }
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null

    render(
      <PdfTranslationView
        file={{ name: 'scan.pdf', path: SCAN_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))

    expect(await screen.findByText('translate.pdf.error.ocr_required')).toBeInTheDocument()
  })

  it('explains when the completed PDF could not be saved to history', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') {
        return Promise.reject(
          new IpcError(translateErrorCodes.PDF_RESULT_PERSIST_FAILED, 'Could not save the translated PDF')
        )
      }
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))

    expect(await screen.findByText('translate.pdf.error.persist_failed')).toBeInTheDocument()
  })

  it('shows a generic message for an unknown sidecar failure instead of the raw stderr', async () => {
    const rawStderr =
      'Traceback (most recent call last):\n  /Users/secret/proj/babeldoc/main.py line 42\nRuntimeError: boom'
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') {
        return Promise.reject(new IpcError('INTERNAL', rawStderr))
      }
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))

    // The localized generic message is shown; the raw stderr/traceback never reaches the UI.
    expect(await screen.findByText('translate.pdf.error.generic')).toBeInTheDocument()
    expect(screen.queryByText(rawStderr)).not.toBeInTheDocument()
  })

  it('shows the BabelDOC install prompt before translation when the dependency is missing', () => {
    const onInstallBabelDoc = vi.fn()

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="missing"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={vi.fn()}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={onInstallBabelDoc}
        onBabelDocUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText('translate.pdf.dependency.title')).toBeInTheDocument()
    expect(screen.getByText('translate.pdf.dependency.description')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.install_babeldoc' }))
    expect(onInstallBabelDoc).toHaveBeenCalledOnce()
  })

  it('shows installation progress while BabelDOC is being installed', () => {
    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="missing"
        babelDocInstalling
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={vi.fn()}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText('translate.pdf.dependency.installing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'translate.pdf.action.install_babeldoc' })).not.toBeInTheDocument()
  })

  it('offers an update when the installed BabelDOC is outdated', () => {
    const onInstallBabelDoc = vi.fn()

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="outdated"
        babelDocInstalling={false}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={vi.fn()}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={onInstallBabelDoc}
        onBabelDocUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText('translate.pdf.dependency.outdated_title')).toBeInTheDocument()
    expect(screen.getByText('translate.pdf.dependency.outdated_description')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'translate.pdf.action.update_babeldoc' }))
    expect(onInstallBabelDoc).toHaveBeenCalledOnce()
  })

  it('renders streamed text fallback content under a text translation header', () => {
    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: PAPER_PATH }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="missing"
        babelDocInstalling={false}
        textFallback={{ content: <div>streamed translation</div>, ocrRequired: false }}
        onClose={vi.fn()}
        onJobChange={onJobChange}
        onHandleChange={vi.fn()}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText('translate.pdf.pane.translated_text')).toBeInTheDocument()
    expect(screen.getByText('streamed translation')).toBeInTheDocument()
    expect(screen.queryByText('translate.pdf.dependency.title')).not.toBeInTheDocument()
  })
})
