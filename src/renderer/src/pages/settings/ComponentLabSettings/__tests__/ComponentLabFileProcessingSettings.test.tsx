import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { FileMetadata } from '@renderer/types'
import { FileEntrySchema } from '@shared/data/types/file'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ComponentLabFileProcessingSettings from '../ComponentLabFileProcessingSettings'

const selectFileMock = vi.hoisted(() => vi.fn())
const ensureExternalEntryMock = vi.hoisted(() => vi.fn())
const startTaskMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
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
  useJob: () => ({ data: undefined, isTerminal: false }),
  useJobProgress: () => ({ progress: 0 })
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

const fileEntry = FileEntrySchema.parse({
  id: '019606a0-0000-7000-8000-000000000301',
  origin: 'external',
  name: 'scan',
  ext: 'png',
  externalPath: '/tmp/scan.png',
  createdAt: 1779811200000,
  updatedAt: 1779811200000
})

describe('ComponentLabFileProcessingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectFileMock.mockResolvedValue([selectedImage])
    ensureExternalEntryMock.mockResolvedValue(fileEntry)
    startTaskMock.mockResolvedValue({
      taskId: 'job-1',
      feature: 'image_to_text',
      processorId: 'tesseract',
      status: 'pending',
      progress: 0
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          select: selectFileMock,
          ensureExternalEntry: ensureExternalEntryMock
        },
        fileProcessing: {
          startTask: startTaskMock
        }
      }
    })
  })

  it('starts file-processing jobs with a file entry id from the selected file path', async () => {
    render(<ComponentLabFileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings\.componentLab\.fileProcessing\.ocr\.select/ }))

    await waitFor(() => {
      expect(screen.getByText('/tmp/scan.png')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /settings\.componentLab\.fileProcessing\.ocr\.start/ }))

    await waitFor(() => {
      expect(startTaskMock).toHaveBeenCalledWith({
        feature: 'image_to_text',
        fileEntryId: fileEntry.id,
        processorId: 'tesseract'
      })
    })
    expect(ensureExternalEntryMock).toHaveBeenCalledWith({ externalPath: '/tmp/scan.png' })
    expect(startTaskMock.mock.calls[0][0]).not.toHaveProperty('file')
  })
})
