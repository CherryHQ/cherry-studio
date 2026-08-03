import type * as CherryStudioUi from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openSettingsTab: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return importOriginal<typeof CherryStudioUi>()
})

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.go_to_settings': 'Go to settings',
        'knowledge.not_set': 'Not set',
        'knowledge.rag.file_processing': 'File processing',
        'knowledge.rag.file_processing_hint': 'Choose a document processor',
        'knowledge.rag.processor_not_configured': 'Not configured'
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
})

const options = [
  { value: 'paddleocr', label: 'PaddleOCR', disabled: false },
  { value: 'doc2x', label: 'Doc2X', disabled: true }
]

const renderSection = (onFileProcessorChange = vi.fn()) => {
  render(
    <FileProcessingSection
      fileProcessorId={null}
      fileProcessorOptions={options}
      onFileProcessorChange={onFileProcessorChange}
    />
  )
  return onFileProcessorChange
}

describe('FileProcessingSection', () => {
  it('shows unavailable processors without allowing selection', () => {
    const onFileProcessorChange = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'File processing' }))

    expect(screen.getByTestId('file-processor-selector-content')).toHaveStyle({ height: '149px' })
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByTestId('processor-icon-paddleocr').querySelector('svg')).toBeInTheDocument()
    expect(screen.getByTestId('processor-icon-doc2x').querySelector('svg')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Doc2X/ }))
    expect(onFileProcessorChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('option', { name: 'PaddleOCR' }))
    expect(onFileProcessorChange).toHaveBeenCalledWith('paddleocr')
  })

  it('clears the selection and opens document processing settings from the footer', () => {
    const onFileProcessorChange = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not set' }))
    expect(onFileProcessorChange).toHaveBeenCalledWith(null)

    fireEvent.click(screen.getByRole('button', { name: 'File processing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to settings' }))
    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/file-processing')
  })
})
