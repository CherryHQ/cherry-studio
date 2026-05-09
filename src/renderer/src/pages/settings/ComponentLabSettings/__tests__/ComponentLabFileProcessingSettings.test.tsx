import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FileMetadata } from '@types'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ComponentLabFileProcessingSettings from '../ComponentLabFileProcessingSettings'
import ComponentLabSettings from '../ComponentLabSettings'

const selectFileMock = vi.hoisted(() => vi.fn())
const startTaskMock = vi.hoisted(() => vi.fn())
const getTaskMock = vi.hoisted(() => vi.fn())
const listAvailableProcessorsMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (values?.count !== undefined) {
        return `${key}:${values.count}`
      }

      if (values?.seconds !== undefined) {
        return `${key}:${values.seconds}`
      }

      return key
    }
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('../..', () => ({
  SettingContainer: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SettingDivider: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  SettingGroup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SettingTitle: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [
    {
      overrides: {}
    },
    vi.fn()
  ]
}))

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span {...props} data-variant={variant}>
      {children}
    </span>
  ),
  Button: ({
    children,
    loading,
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; size?: string; variant?: string }) => {
    void loading
    void variant
    void size

    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Tabs: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { defaultValue?: string; variant?: string }) => (
    <div {...props}>{children}</div>
  ),
  TabsContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { value?: string }) => (
    <div {...props}>{children}</div>
  ),
  TabsList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => (
    <button type="button" {...props} data-value={value}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/pages/agents/components/AgentTodoListPanel', () => ({
  default: () => <div data-testid="agent-todo-list-panel" />
}))

vi.mock('../ComponentLabAgentSelectorSettings', () => ({
  default: () => <div data-testid="agent-selector-panel" />
}))

vi.mock('../ComponentLabAssistantSelectorSettings', () => ({
  default: () => <div data-testid="assistant-selector-panel" />
}))

vi.mock('../ComponentLabModelSelectorSettings', () => ({
  default: () => <div data-testid="model-selector-panel" />
}))

vi.mock('../../FileProcessingSettings/utils/fileProcessingMeta', () => ({
  getProcessorNameKey: (processorId: string) => `processor.${processorId}`
}))

const imageFile: FileMetadata = {
  id: 'image-file',
  name: 'sample.png',
  origin_name: 'sample.png',
  path: '/tmp/sample.png',
  size: 10,
  ext: '.png',
  type: 'image',
  created_at: '2026-05-09T00:00:00.000Z',
  count: 1
}

const documentFile: FileMetadata = {
  id: 'document-file',
  name: 'sample.pdf',
  origin_name: 'sample.pdf',
  path: '/tmp/sample.pdf',
  size: 10,
  ext: '.pdf',
  type: 'document',
  created_at: '2026-05-09T00:00:00.000Z',
  count: 1
}

describe('ComponentLabFileProcessingSettings', () => {
  beforeEach(() => {
    selectFileMock.mockReset()
    startTaskMock.mockReset()
    getTaskMock.mockReset()
    listAvailableProcessorsMock.mockReset()
    listAvailableProcessorsMock.mockResolvedValue({
      processorIds: ['system', 'tesseract', 'paddleocr', 'mineru', 'doc2x', 'mistral', 'open-mineru']
    })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          select: selectFileMock
        },
        fileProcessing: {
          startTask: startTaskMock,
          getTask: getTaskMock,
          cancelTask: vi.fn(),
          listAvailableProcessors: listAvailableProcessorsMock
        }
      }
    })
  })

  it('adds the file processing tab to Component Lab', () => {
    render(<ComponentLabSettings />)

    expect(screen.getByRole('button', { name: 'settings.componentLab.fileProcessing.title' })).toBeInTheDocument()
  })

  it('starts every image-to-text processor after selecting an OCR file', async () => {
    selectFileMock.mockResolvedValueOnce([imageFile])
    startTaskMock.mockImplementation(({ processorId }) =>
      Promise.resolve({
        taskId: `ocr-${processorId}`,
        feature: 'image_to_text',
        processorId,
        progress: 0,
        status: 'pending'
      })
    )
    getTaskMock.mockImplementation(({ taskId }) =>
      Promise.resolve({
        taskId,
        feature: 'image_to_text',
        processorId: taskId.replace('ocr-', ''),
        progress: 100,
        status: 'completed',
        artifacts: [{ kind: 'text', format: 'plain', text: `result-${taskId}` }]
      })
    )

    render(<ComponentLabFileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.ocr.select/ }))

    await waitFor(() => {
      expect(screen.getByText('/tmp/sample.png')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.ocr.start/ }))

    await waitFor(() => {
      expect(startTaskMock).toHaveBeenCalledTimes(4)
    })

    expect(startTaskMock.mock.calls.map(([payload]) => payload.processorId).sort()).toEqual([
      'mistral',
      'paddleocr',
      'system',
      'tesseract'
    ])
    expect(startTaskMock.mock.calls.every(([payload]) => payload.feature === 'image_to_text')).toBe(true)
    expect(startTaskMock.mock.calls.every(([payload]) => payload.file === imageFile)).toBe(true)
  })

  it('includes OV OCR in Component Lab only when file processing reports it as available', async () => {
    listAvailableProcessorsMock.mockResolvedValueOnce({
      processorIds: ['system', 'tesseract', 'paddleocr', 'mineru', 'doc2x', 'mistral', 'open-mineru', 'ovocr']
    })
    selectFileMock.mockResolvedValueOnce([imageFile])
    startTaskMock.mockImplementation(({ processorId }) =>
      Promise.resolve({
        taskId: `ocr-${processorId}`,
        feature: 'image_to_text',
        processorId,
        progress: 0,
        status: 'pending'
      })
    )
    getTaskMock.mockImplementation(({ taskId }) =>
      Promise.resolve({
        taskId,
        feature: 'image_to_text',
        processorId: taskId.replace('ocr-', ''),
        progress: 100,
        status: 'completed',
        artifacts: [{ kind: 'text', format: 'plain', text: `result-${taskId}` }]
      })
    )

    render(<ComponentLabFileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.ocr.select/ }))

    await waitFor(() => {
      expect(screen.getByText('/tmp/sample.png')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.ocr.start/ }))

    await waitFor(() => {
      expect(startTaskMock).toHaveBeenCalledTimes(5)
    })

    expect(startTaskMock.mock.calls.map(([payload]) => payload.processorId).sort()).toEqual([
      'mistral',
      'ovocr',
      'paddleocr',
      'system',
      'tesseract'
    ])
  })

  it('starts every document-to-markdown processor after selecting a Markdown test file', async () => {
    selectFileMock.mockResolvedValueOnce([documentFile])
    startTaskMock.mockImplementation(({ processorId }) =>
      Promise.resolve({
        taskId: `markdown-${processorId}`,
        feature: 'document_to_markdown',
        processorId,
        progress: 0,
        status: 'pending'
      })
    )
    getTaskMock.mockImplementation(({ taskId }) =>
      Promise.resolve({
        taskId,
        feature: 'document_to_markdown',
        processorId: taskId.replace('markdown-', ''),
        progress: 100,
        status: 'completed',
        artifacts: [{ kind: 'file', format: 'markdown', path: `/tmp/${taskId}/output.md` }]
      })
    )

    render(<ComponentLabFileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.markdown.select/ }))

    await waitFor(() => {
      expect(screen.getByText('/tmp/sample.pdf')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.markdown.start/ }))

    await waitFor(() => {
      expect(startTaskMock).toHaveBeenCalledTimes(5)
    })

    expect(startTaskMock.mock.calls.map(([payload]) => payload.processorId).sort()).toEqual([
      'doc2x',
      'mineru',
      'mistral',
      'open-mineru',
      'paddleocr'
    ])
    expect(startTaskMock.mock.calls.every(([payload]) => payload.feature === 'document_to_markdown')).toBe(true)
    expect(startTaskMock.mock.calls.every(([payload]) => payload.file === documentFile)).toBe(true)
  })

  it('renders completed and failed processor results independently', async () => {
    selectFileMock.mockResolvedValueOnce([imageFile])
    startTaskMock.mockImplementation(({ processorId }) =>
      Promise.resolve({
        taskId: `ocr-${processorId}`,
        feature: 'image_to_text',
        processorId,
        progress: 0,
        status: 'pending'
      })
    )
    getTaskMock.mockImplementation(({ taskId }) => {
      if (taskId === 'ocr-paddleocr') {
        return Promise.resolve({
          taskId,
          feature: 'image_to_text',
          processorId: 'paddleocr',
          progress: 45,
          status: 'failed',
          error: 'PaddleOCR failed'
        })
      }

      return Promise.resolve({
        taskId,
        feature: 'image_to_text',
        processorId: taskId.replace('ocr-', ''),
        progress: 100,
        status: 'completed',
        artifacts: [{ kind: 'text', format: 'plain', text: `text-${taskId}` }]
      })
    })

    render(<ComponentLabFileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.ocr.select/ }))

    await waitFor(() => {
      expect(screen.getByText('/tmp/sample.png')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /settings.componentLab.fileProcessing.ocr.start/ }))

    await waitFor(() => {
      expect(screen.getByText('PaddleOCR failed')).toBeInTheDocument()
    })

    expect(screen.getAllByText('settings.componentLab.fileProcessing.status.completed').length).toBeGreaterThan(0)
    expect(screen.getByText('settings.componentLab.fileProcessing.status.failed')).toBeInTheDocument()
  })
})
