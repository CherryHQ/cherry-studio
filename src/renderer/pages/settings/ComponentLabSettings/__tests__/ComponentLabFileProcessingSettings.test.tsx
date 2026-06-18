import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { FileMetadata } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ComponentLabFileProcessingSettings from '../ComponentLabFileProcessingSettings'

const selectFileMock = vi.hoisted(() => vi.fn())
const createTempFileMock = vi.hoisted(() => vi.fn())
const ipcRequestMock = vi.hoisted(() => vi.fn())
const useJobMock = vi.hoisted(() => vi.fn())
const useJobProgressMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'settings.componentLab.fileProcessing.status.running': 'Running'
      }
      if (translations[key]) {
        return translations[key]
      }
      if (key === 'settings.componentLab.fileProcessing.processorCount') {
        return `${params?.count ?? 0} processors`
      }
      return key
    }
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [{ overrides: {} }]
}))

vi.mock('@renderer/hooks/useJob', () => ({
  useJob: useJobMock,
  useJobProgress: useJobProgressMock
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcRequestMock
  }
}))

vi.mock('../../FileProcessingSettings/hooks/useAvailableFileProcessors', () => ({
  useAvailableFileProcessors: () => ({
    processorIds: new Set(['tesseract']),
    status: 'ready'
  })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()

  return {
    ...actual,
    Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => {
      delete props.loading

      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    }
  }
})

const selectedImage: FileMetadata = {
  id: 'legacy-file',
  name: 'scan.png',
  origin_name: 'scan.png',
  path: '/tmp/scan.png',
  size: 1024,
  ext: '.png',
  type: 'image',
  created_at: '2026-05-27T00:00:00.000Z',
  count: 1
}

describe('ComponentLabFileProcessingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useJobMock.mockReturnValue({ data: undefined, isTerminal: false })
    useJobProgressMock.mockReturnValue({ progress: 0 })
    selectFileMock.mockResolvedValue([selectedImage])
    createTempFileMock.mockResolvedValue('/tmp/lab-tesseract.md')
    ipcRequestMock.mockResolvedValue({
      id: 'job-1',
      type: 'file-processing.background',
      status: 'pending'
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          select: selectFileMock,
          createTempFile: createTempFileMock
        }
      }
    })
  })

  it('starts file-processing jobs with a path handle from the selected file path', async () => {
    render(<ComponentLabFileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings\.componentLab\.fileProcessing\.ocr\.select/ }))

    await waitFor(() => {
      expect(screen.getByText('/tmp/scan.png')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /settings\.componentLab\.fileProcessing\.ocr\.start/ }))

    await waitFor(() => {
      expect(ipcRequestMock).toHaveBeenCalledWith('file_processing.start_job', {
        feature: 'image_to_text',
        file: { kind: 'path', path: '/tmp/scan.png' },
        processorId: 'tesseract'
      })
    })
    // OCR is a text feature: no output target is required.
    expect(ipcRequestMock.mock.calls[0][1]).not.toHaveProperty('output')
    expect(ipcRequestMock.mock.calls[0][1]).not.toHaveProperty('fileEntryId')
  })

  it('renders active job status labels instead of raw i18n keys', async () => {
    useJobMock.mockReturnValue({
      data: {
        id: 'job-1',
        type: 'file-processing.background',
        status: 'running',
        output: null,
        error: null
      },
      isTerminal: false
    })

    render(<ComponentLabFileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings\.componentLab\.fileProcessing\.ocr\.select/ }))

    await waitFor(() => {
      expect(screen.getByText('/tmp/scan.png')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /settings\.componentLab\.fileProcessing\.ocr\.start/ }))

    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(screen.queryByText('settings.componentLab.fileProcessing.status.running')).not.toBeInTheDocument()
  })
})
