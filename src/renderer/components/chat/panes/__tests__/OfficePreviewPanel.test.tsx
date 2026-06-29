import { render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.request
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({
    title,
    description,
    actions
  }: PropsWithChildren<{ title?: string; description?: string; actions?: React.ReactNode }>) => (
    <div data-testid="empty-state">
      {title}
      {description}
      {actions}
    </div>
  ),
  LoadingState: ({ label }: { label?: string }) => <div data-testid="loading-state">{label}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import OfficePreviewPanel from '../OfficePreviewPanel'

describe('OfficePreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders xlsx previews as an Excel document frame', async () => {
    mocks.request.mockResolvedValueOnce({
      status: 'ready',
      extension: 'xlsx',
      type: 'excel',
      html: '<!DOCTYPE html><html><body><div class="spreadsheet-tabs"><a href="#sheet-0">Sheet1</a></div><div class="spreadsheet-sheet active"><table><tr><td>A1</td></tr></table></div><script>window.__office=1</script></body></html>'
    })

    const { container } = render(
      <OfficePreviewPanel workspacePath="/tmp/workspace" filePath="report.xlsx" refreshKey={0} />
    )

    await waitFor(() => expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument())
    expect(mocks.request).toHaveBeenCalledWith('office_preview.render', {
      workspacePath: '/tmp/workspace',
      filePath: 'report.xlsx'
    })

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const srcDoc = iframe?.getAttribute('srcdoc') ?? ''
    expect(screen.getByTestId('office-preview-frame')).toHaveAttribute('data-office-preview-type', 'excel')
    expect(srcDoc).toContain('spreadsheet-tabs')
    expect(srcDoc).toContain('spreadsheet-sheet active')
    expect(srcDoc).toContain('<script>window.__office=1</script>')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  })

  it('renders docx previews as a generic HTML document frame', async () => {
    mocks.request.mockResolvedValueOnce({
      status: 'ready',
      extension: 'docx',
      type: 'html',
      html: '<p>Hello</p>'
    })

    const { container } = render(
      <OfficePreviewPanel workspacePath="/tmp/workspace" filePath="report.docx" refreshKey={0} />
    )

    await waitFor(() => expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument())
    expect(screen.getByTestId('office-preview-frame')).toHaveAttribute('data-office-preview-type', 'html')
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<p>Hello</p>')
  })
})
