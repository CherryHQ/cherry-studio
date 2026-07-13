import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PdfTranslationView, { type PdfTranslationHandle } from '../PdfTranslationView'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  stageHandler: null as null | ((payload: { jobId: string; stage: 'installing' | 'translating' }) => void),
  uuid: vi.fn(() => 'b289bad7-a813-4cf7-91c0-2a9dc82235b2')
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (_event: string, handler: typeof mocks.stageHandler) => {
    mocks.stageHandler = handler
  }
}))
vi.mock('@renderer/utils/uuid', () => ({ uuid: mocks.uuid }))
vi.mock('@renderer/components/ArtifactPreview/pdf/PdfPreviewPanel', () => ({
  default: ({ filePath }: { filePath: string }) => <div data-testid="pdf-preview" data-file-path={filePath} />
}))

describe('PdfTranslationView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stageHandler = null
  })

  it('translates through IpcApi and previews the generated bilingual PDF beside the source', async () => {
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'translate.pdf.start') {
        return { fileName: 'paper.zh-CN.dual.pdf', outputPath: '/tmp/job/paper.zh-CN.dual.pdf' }
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
        onClose={vi.fn()}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={onStatusChange}
      />
    )

    expect(screen.getByText('translate.pdf.pane.source')).toBeInTheDocument()
    expect(screen.getByText('translate.pdf.pane.translated')).toBeInTheDocument()
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
    expect(screen.getAllByTestId('pdf-preview')[1]).toHaveAttribute('data-file-path', '/tmp/job/paper.zh-CN.dual.pdf')
    expect(onStatusChange).toHaveBeenLastCalledWith({ phase: 'success', running: false })
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
        onClose={vi.fn()}
        onHandleChange={(next) => {
          handle = next
        }}
        onStatusChange={vi.fn()}
      />
    )
    await waitFor(() => expect(handle).not.toBeNull())
    act(() => handle!.start('zh-cn'))
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('translate.pdf.start', expect.anything()))

    unmount()
    expect(mocks.ipcRequest).toHaveBeenCalledWith('translate.pdf.cancel', {
      jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2'
    })

    resolveStart({ fileName: 'paper.zh-CN.dual.pdf', outputPath: '/tmp/job/paper.zh-CN.dual.pdf' })
    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('translate.pdf.cleanup', {
        jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2'
      })
    )
  })
})
