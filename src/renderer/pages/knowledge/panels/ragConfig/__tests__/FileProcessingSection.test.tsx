import type * as CherryStudioUi from '@cherrystudio/ui'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openSettingsTab: vi.fn(),
  showDownloadPopup: vi.fn<(params: Record<string, unknown>) => Promise<boolean>>(),
  localModel: {
    status: 'ready' as 'not_downloaded' | 'downloading' | 'ready' | 'error' | 'unsupported',
    isStatusResolved: true,
    percent: 0,
    download: vi.fn<() => Promise<boolean>>(),
    cancel: vi.fn(),
    remove: vi.fn()
  },
  connectivity: { reachable: true, isResolved: true }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return importOriginal<typeof CherryStudioUi>()
})

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/components/popups/LocalModelDownloadPopup', () => ({
  default: { show: mocks.showDownloadPopup }
}))
vi.mock('@renderer/hooks/useLocalModel', () => ({ useLocalModel: () => mocks.localModel }))
vi.mock('../../../hooks/useOpenMineruConnectivity', () => ({
  useOpenMineruConnectivity: () => mocks.connectivity
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.cancel': 'Cancel',
        'common.go_to_settings': 'Go to settings',
        'knowledge.rag.file_processing': 'File processing',
        'knowledge.rag.file_processing_hint': 'Choose a document processor',
        'knowledge.rag.file_processing_none': "Don't use",
        'knowledge.rag.processor_not_downloaded': 'Not downloaded',
        'knowledge.rag.processor_unreachable': 'Service not running',
        'settings.dependencies.localModels.download': 'Download',
        'settings.dependencies.localModels.ocr.subtitle': 'PaddleOCR PP-OCRv6 · ~140 MB'
      })[key] ?? key
  })
}))

import FileProcessingSection from '../FileProcessingSection'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.localModel.status = 'ready'
  mocks.localModel.isStatusResolved = true
  mocks.connectivity = { reachable: true, isResolved: true }
})

const options = [
  { value: 'paddleocr', label: 'PaddleOCR', disabled: false },
  { value: 'doc2x', label: 'Doc2X', disabled: true, statusLabel: 'Not configured' },
  { value: 'mineru', label: 'MinerU', disabled: false }
]

const LOCAL_OPTION = { value: 'local-document', label: 'Local document', disabled: false }
const SELF_HOSTED_OPTION = { value: 'open-mineru', label: 'Open MinerU', disabled: false }

const renderWithSelfHostedProcessor = (onFileProcessorChange = vi.fn()) => {
  render(
    <FileProcessingSection
      fileProcessorId={null}
      initialFileProcessorId={null}
      fileProcessorOptions={[...options, SELF_HOSTED_OPTION]}
      onFileProcessorChange={onFileProcessorChange}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
  return onFileProcessorChange
}

const renderSection = (onFileProcessorChange = vi.fn()) => {
  render(
    <FileProcessingSection
      fileProcessorId={null}
      initialFileProcessorId={null}
      fileProcessorOptions={options}
      onFileProcessorChange={onFileProcessorChange}
    />
  )
  return onFileProcessorChange
}

const renderWithLocalProcessor = (onFileProcessorChange = vi.fn()) => {
  render(
    <FileProcessingSection
      fileProcessorId={null}
      initialFileProcessorId={null}
      fileProcessorOptions={[...options, LOCAL_OPTION]}
      onFileProcessorChange={onFileProcessorChange}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
  return onFileProcessorChange
}

describe('FileProcessingSection', () => {
  it('shows unavailable processors without allowing selection', () => {
    const onFileProcessorChange = renderSection()

    const trigger = screen.getByRole('button', { name: 'File processing' })
    fireEvent.click(trigger)

    expect(screen.getByTestId('file-processor-selector-content')).toHaveStyle({ height: '185px' })
    // Select triggers must not add border or outer-ring feedback when expanded.
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).not.toHaveClass(
      'aria-expanded:border-primary',
      'aria-expanded:ring-3',
      'aria-expanded:ring-primary/20'
    )
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByTestId('processor-icon-paddleocr').querySelector('svg')).toBeInTheDocument()
    expect(screen.getByTestId('processor-icon-doc2x').querySelector('svg')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Doc2X/ }))
    expect(onFileProcessorChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('option', { name: 'PaddleOCR' }))
    expect(onFileProcessorChange).toHaveBeenCalledWith('paddleocr')
  })

  it('renders an icon for every processor, falling back when one has no logo', () => {
    const onFileProcessorChange = vi.fn()
    render(
      <FileProcessingSection
        fileProcessorId="local-document"
        initialFileProcessorId="local-document"
        fileProcessorOptions={[LOCAL_OPTION, { value: 'not-a-real-processor', label: 'Unmapped', disabled: false }]}
        onFileProcessorChange={onFileProcessorChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'File processing' }))

    // A missing logo used to throw on `Logo.Avatar` and take the whole panel down.
    expect(screen.getAllByTestId('processor-icon-local-document')[0].querySelector('img')).toBeInTheDocument()
    expect(screen.getByTestId('processor-icon-not-a-real-processor').querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Local document' })).toBeInTheDocument()
  })

  it('clears the selection and opens document processing settings from the footer', () => {
    const onFileProcessorChange = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
    fireEvent.click(screen.getByRole('button', { name: "Don't use" }))
    expect(onFileProcessorChange).toHaveBeenCalledWith(null)

    fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to settings' }))
    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/file-processing')
  })

  it('focuses the list and skips unavailable processors during keyboard navigation', async () => {
    const user = userEvent.setup()
    const onFileProcessorChange = renderSection()

    await user.click(screen.getByRole('button', { name: 'File processing' }))

    const listbox = screen.getByRole('listbox', { name: 'File processing' })
    const paddleOption = screen.getByRole('option', { name: 'PaddleOCR' })
    const mineruOption = screen.getByRole('option', { name: 'MinerU' })
    await waitFor(() => {
      expect(listbox).toHaveFocus()
      expect(listbox).toHaveAttribute('aria-activedescendant', paddleOption.id)
    })

    await user.keyboard('{ArrowDown}')
    expect(listbox).toHaveAttribute('aria-activedescendant', mineruOption.id)

    await user.keyboard('{ArrowUp}')
    expect(listbox).toHaveAttribute('aria-activedescendant', paddleOption.id)

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onFileProcessorChange).toHaveBeenCalledWith('mineru')
  })

  describe('local model processors', () => {
    // Hiding the row is what stranded users before: the download it needs is
    // only reachable by selecting it.
    it('stays selectable while its model is missing and says so', async () => {
      mocks.localModel.status = 'not_downloaded'
      mocks.showDownloadPopup.mockResolvedValue(true)
      const onFileProcessorChange = renderWithLocalProcessor()

      const option = screen.getByRole('option', { name: /Local document/ })
      expect(option).not.toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText('Not downloaded')).toBeInTheDocument()

      fireEvent.click(option)

      await waitFor(() => expect(mocks.showDownloadPopup).toHaveBeenCalled())
      expect(mocks.showDownloadPopup.mock.calls[0][0]).toMatchObject({
        id: 'pp-ocrv6-medium',
        description: 'PaddleOCR PP-OCRv6 · ~140 MB'
      })
      await waitFor(() => expect(onFileProcessorChange).toHaveBeenCalledWith('local-document'))
    })

    // The dialog resolves false for a decline, a mid-download cancel and a download
    // the user gave up on — all three must leave the processor unselected, since it
    // cannot run without the model.
    it('leaves the selection alone unless the model actually arrives', async () => {
      mocks.localModel.status = 'not_downloaded'
      mocks.showDownloadPopup.mockResolvedValue(false)
      const onFileProcessorChange = renderWithLocalProcessor()

      fireEvent.click(screen.getByRole('option', { name: /Local document/ }))

      await waitFor(() => expect(mocks.showDownloadPopup).toHaveBeenCalled())
      expect(onFileProcessorChange).not.toHaveBeenCalled()
    })

    it('selects without prompting once the model is ready', () => {
      const onFileProcessorChange = renderWithLocalProcessor()

      expect(screen.queryByText('Not downloaded')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('option', { name: 'Local document' }))

      expect(mocks.showDownloadPopup).not.toHaveBeenCalled()
      expect(onFileProcessorChange).toHaveBeenCalledWith('local-document')
    })

    it('drops the processor entirely when the platform cannot run it', () => {
      mocks.localModel.status = 'unsupported'
      renderWithLocalProcessor()

      expect(screen.queryByRole('option', { name: /Local document/ })).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'PaddleOCR' })).toBeInTheDocument()
    })

    it('keeps a persisted processor visible but disabled while platform support is unavailable', () => {
      mocks.localModel.status = 'unsupported'
      render(
        <FileProcessingSection
          fileProcessorId="local-document"
          initialFileProcessorId="local-document"
          fileProcessorOptions={[...options, LOCAL_OPTION]}
          onFileProcessorChange={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
      expect(screen.getByRole('option', { name: 'Local document' })).toHaveAttribute('aria-disabled', 'true')
    })

    it('holds back the status label until the probe answers', () => {
      mocks.localModel.status = 'not_downloaded'
      mocks.localModel.isStatusResolved = false
      const onFileProcessorChange = renderWithLocalProcessor()

      expect(screen.queryByText('Not downloaded')).not.toBeInTheDocument()
      const option = screen.getByRole('option', { name: 'Local document' })
      expect(option).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(option)
      expect(onFileProcessorChange).not.toHaveBeenCalled()
    })

    it('does not select a processor while its model is still downloading', () => {
      mocks.localModel.status = 'downloading'
      const onFileProcessorChange = renderWithLocalProcessor()

      const option = screen.getByRole('option', { name: 'Local document' })
      expect(option).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(option)
      expect(onFileProcessorChange).not.toHaveBeenCalled()
    })
  })

  describe('self-hosted processors', () => {
    // Its preset ships a working default host and it needs no API key, so nothing
    // in the config distinguishes a real deployment from a user who did nothing —
    // the reachability probe is the only signal there is. Starting the server is
    // outside the app, so an unreachable row has nothing to offer and is dropped.
    it('drops the row entirely when its server is not answering', () => {
      mocks.connectivity = { reachable: false, isResolved: true }
      renderWithSelfHostedProcessor()

      expect(screen.queryByRole('option', { name: /Open MinerU/ })).not.toBeInTheDocument()
      expect(screen.queryByText('Service not running')).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'MinerU' })).toBeInTheDocument()
    })

    it('selects without comment once its server answers', () => {
      const onFileProcessorChange = renderWithSelfHostedProcessor()

      expect(screen.queryByText('Service not running')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('option', { name: 'Open MinerU' }))
      expect(onFileProcessorChange).toHaveBeenCalledWith('open-mineru')
    })

    it('stays disabled while the probe is still in flight', () => {
      mocks.connectivity = { reachable: false, isResolved: false }
      const onFileProcessorChange = renderWithSelfHostedProcessor()

      expect(screen.queryByText('Service not running')).not.toBeInTheDocument()
      const option = screen.getByRole('option', { name: 'Open MinerU' })
      expect(option).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(option)
      expect(onFileProcessorChange).not.toHaveBeenCalled()
    })

    it('leaves every other processor untouched when the probe fails', () => {
      mocks.connectivity = { reachable: false, isResolved: true }
      const onFileProcessorChange = renderWithSelfHostedProcessor()

      expect(screen.getByRole('option', { name: 'PaddleOCR' })).toBeInTheDocument()
      // Selecting closes the list, so assert on the other rows first.
      fireEvent.click(screen.getByRole('option', { name: 'MinerU' }))
      expect(onFileProcessorChange).toHaveBeenCalledWith('mineru')
    })

    // Dropping the row of a base that is saved with it would make the trigger fall
    // back to the placeholder, reading as "not in use" for a base still configured
    // to use it. Keep it listed and say why it is not working.
    it('keeps a saved selection visible when its server went down', () => {
      mocks.connectivity = { reachable: false, isResolved: true }
      render(
        <FileProcessingSection
          fileProcessorId="open-mineru"
          initialFileProcessorId="open-mineru"
          fileProcessorOptions={[...options, SELF_HOSTED_OPTION]}
          onFileProcessorChange={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: 'File processing' })).toHaveTextContent('Open MinerU')
      fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
      expect(screen.getByText('Service not running')).toBeInTheDocument()
    })

    it('does not treat an unreachable draft as an already saved selection', () => {
      mocks.connectivity = { reachable: false, isResolved: true }
      render(
        <FileProcessingSection
          fileProcessorId="open-mineru"
          initialFileProcessorId={null}
          fileProcessorOptions={[...options, SELF_HOSTED_OPTION]}
          onFileProcessorChange={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
      expect(screen.queryByRole('option', { name: /Open MinerU/ })).not.toBeInTheDocument()
    })
  })
})
