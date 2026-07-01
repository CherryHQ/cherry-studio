import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  wordPreviewPanelProps: [] as Array<{ fileName: string; filePath: string; refreshKey: number; sourceSize?: number }>,
  pptxPreviewPanelProps: [] as Array<{ fileName: string; filePath: string; refreshKey: number; sourceSize?: number }>,
  wordPreviewPanelModuleLoadCount: 0,
  pptxPreviewPanelModuleLoadCount: 0
}))

vi.mock('../WordPreviewPanel', () => {
  mocks.wordPreviewPanelModuleLoadCount += 1
  return {
    default: (props: { fileName: string; filePath: string; refreshKey: number; sourceSize?: number }) => {
      mocks.wordPreviewPanelProps.push(props)
      return <div data-testid="word-preview-panel" data-file-name={props.fileName} data-file-path={props.filePath} />
    },
    __esModule: true
  }
})

vi.mock('../PptxPreviewPanel', () => {
  mocks.pptxPreviewPanelModuleLoadCount += 1
  return {
    default: (props: { fileName: string; filePath: string; refreshKey: number; sourceSize?: number }) => {
      mocks.pptxPreviewPanelProps.push(props)
      return <div data-testid="pptx-preview-panel" data-file-name={props.fileName} data-file-path={props.filePath} />
    },
    __esModule: true
  }
})

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren<{ content: string }>) => <>{children}</>,
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  )
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' ')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { extension?: string }) => {
      if (key === 'agent.preview_pane.office.title') return `unsupported ${options?.extension ?? ''}`
      return key
    }
  })
}))

import OfficePreviewPanel from '../OfficePreviewPanel'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.wordPreviewPanelProps.length = 0
  mocks.pptxPreviewPanelProps.length = 0
})

afterEach(() => {
  cleanup()
})

describe('OfficePreviewPanel', () => {
  it.each(['legacy.doc', 'slides.ppt'])('shows unsupported state for legacy Office format %s', (fileName) => {
    render(<OfficePreviewPanel filePath={fileName} fileName={fileName} />)

    expect(screen.getByTestId('empty-state')).toHaveTextContent(`unsupported .${fileName.split('.').at(-1)}`)
    expect(mocks.wordPreviewPanelProps).toEqual([])
    expect(mocks.pptxPreviewPanelProps).toEqual([])
    expect(mocks.wordPreviewPanelModuleLoadCount).toBe(0)
    expect(mocks.pptxPreviewPanelModuleLoadCount).toBe(0)
  })

  it('renders the actions slot for the unsupported-format empty state', () => {
    render(
      <OfficePreviewPanel
        filePath="legacy.doc"
        fileName="legacy.doc"
        actions={<button type="button">Open externally</button>}
      />
    )

    expect(screen.getByRole('button', { name: 'Open externally' })).toBeInTheDocument()
  })

  it('renders docx files with the dedicated Word preview panel', async () => {
    render(
      <OfficePreviewPanel
        filePath="report.docx"
        fileName="report.docx"
        sourceFilePath="/tmp/workspace/report.docx"
        refreshKey={2}
        sourceSize={2048}
      />
    )

    expect(await screen.findByTestId('word-preview-panel')).toHaveAttribute(
      'data-file-path',
      '/tmp/workspace/report.docx'
    )
    expect(mocks.wordPreviewPanelProps[0]).toEqual({
      fileName: 'report.docx',
      filePath: '/tmp/workspace/report.docx',
      refreshKey: 2,
      sourceSize: 2048
    })
    expect(mocks.pptxPreviewPanelProps).toEqual([])
  })

  it('renders pptx files with the dedicated PPTX preview panel', async () => {
    render(
      <OfficePreviewPanel
        filePath="slides.pptx"
        fileName="slides.pptx"
        sourceFilePath="/tmp/workspace/slides.pptx"
        refreshKey={3}
        sourceSize={4096}
      />
    )

    expect(await screen.findByTestId('pptx-preview-panel')).toHaveAttribute(
      'data-file-path',
      '/tmp/workspace/slides.pptx'
    )
    expect(mocks.pptxPreviewPanelProps[0]).toEqual({
      fileName: 'slides.pptx',
      filePath: '/tmp/workspace/slides.pptx',
      refreshKey: 3,
      sourceSize: 4096
    })
    expect(mocks.wordPreviewPanelProps).toEqual([])
  })

  it('shows an error when a supported relative file is missing an absolute source path', () => {
    render(<OfficePreviewPanel filePath="report.docx" fileName="report.docx" />)

    expect(screen.getByTestId('empty-state')).toHaveTextContent('common.error')
    expect(mocks.wordPreviewPanelProps).toEqual([])
  })

  it('shows an error state when the docx preview bundle fails to load', async () => {
    vi.resetModules()
    vi.doMock('../WordPreviewPanel', () => {
      throw new Error('failed to fetch dynamically imported module')
    })

    const { default: FreshOfficePreviewPanel } = await import('../OfficePreviewPanel')

    render(
      <FreshOfficePreviewPanel
        filePath="report.docx"
        fileName="report.docx"
        sourceFilePath="/tmp/workspace/report.docx"
      />
    )

    expect(await screen.findByTestId('empty-state')).toHaveTextContent('common.error')

    vi.doUnmock('../WordPreviewPanel')
    vi.resetModules()
  })
})
