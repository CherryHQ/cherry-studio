import { IpcError } from '@shared/ipc/errors/IpcError'
import { translateErrorCodes } from '@shared/ipc/errors/translate'
import type { PdfTranslationProgress } from '@shared/ipc/schemas/translate'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PdfTranslationView, { type PdfTranslationHandle } from '../PdfTranslationView'

const mocks = vi.hoisted(() => ({
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
vi.mock('@renderer/components/ArtifactPreview/pdf/PdfPreviewPanel', () => ({
  default: ({ filePath }: { filePath: string }) => <div data-testid="pdf-preview" data-file-path={filePath} />
}))

describe('PdfTranslationView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
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
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
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
      mocks.progressHandler?.({ jobId: 'another-job', stage: 'translating', progress: 80 })
    })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'parsing',
        progress: 10
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.preparing' })).toHaveAttribute(
      'aria-valuenow',
      '10'
    )

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'processing',
        progress: 30
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.analyzing' })).toHaveAttribute(
      'aria-valuenow',
      '30'
    )

    act(() => {
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'translating',
        progress: 42
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
        progress: 70
      })
      mocks.progressHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'parsing',
        progress: 80
      })
    })
    expect(screen.getByRole('progressbar', { name: 'translate.pdf.progress.generating' })).toHaveAttribute(
      'aria-valuenow',
      '80'
    )
    expect(screen.getByTestId('circular-progress')).toHaveAttribute('data-value', '80')

    resolveStart({ fileName: 'paper.zh-CN.mono.pdf', outputPath: '/tmp/job/paper.zh-CN.mono.pdf' })
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  })

  it('shows PDF resource downloads without a misleading percentage', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') return new Promise(() => {})
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
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
    await waitFor(() => expect(mocks.stageHandler).not.toBeNull())

    act(() => {
      mocks.stageHandler?.({
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
        stage: 'downloading_assets'
      })
    })

    expect(screen.getByText('translate.pdf.progress.downloading_assets')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('cancels an active job on unmount and cleans output that wins the completion race', async () => {
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
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
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

    unmount()
    expect(mocks.ipcRequest).toHaveBeenCalledWith('translate.pdf.cancel', {
      jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2'
    })

    resolveStart({ fileName: 'paper.zh-CN.mono.pdf', outputPath: '/tmp/job/paper.zh-CN.mono.pdf' })
    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('translate.pdf.cleanup', {
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2'
      })
    )
  })

  it('offers inline installation when the PDF runtime reports that BabelDOC is unavailable', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'translate.pdf.start') {
        return Promise.reject(
          new IpcError(translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED, 'BabelDOC 0.6.3 is not installed')
        )
      }
      return Promise.resolve(undefined)
    })
    let handle: PdfTranslationHandle | null = null
    const onInstallBabelDoc = vi.fn()
    const onBabelDocUnavailable = vi.fn()

    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
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
        file={{ name: 'scan.pdf', path: '/tmp/scan.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
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
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="available"
        babelDocInstalling={false}
        onClose={vi.fn()}
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
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="missing"
        babelDocInstalling={false}
        onClose={vi.fn()}
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
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="missing"
        babelDocInstalling
        onClose={vi.fn()}
        onHandleChange={vi.fn()}
        onStatusChange={vi.fn()}
        onInstallBabelDoc={vi.fn()}
        onBabelDocUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText('translate.pdf.dependency.installing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'translate.pdf.action.install_babeldoc' })).not.toBeInTheDocument()
  })

  it('renders streamed text fallback content under a text translation header', () => {
    render(
      <PdfTranslationView
        file={{ name: 'paper.pdf', path: '/tmp/paper.pdf' }}
        modelId="openai::gpt-4.1"
        sourceLangCode="en-us"
        babelDocAvailability="missing"
        babelDocInstalling={false}
        textFallback={{ content: <div>streamed translation</div>, ocrRequired: false }}
        onClose={vi.fn()}
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
