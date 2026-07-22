import type { PrepareTimeline } from '@shared/ai/agentPrepareTimeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockRequest = vi.hoisted(() => vi.fn())
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
const mockWriteText = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" data-testid="copy-diagnostics" onClick={onClick}>
      {children}
    </button>
  )
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mockRequest } }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: mockToastSuccess, error: mockToastError } }))
vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  Copy: () => <span data-testid="copy-icon" />
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, number | string>) => {
      if (key === 'message.tools.placeholder.prepare.footer.summary') {
        return `Response preparation took ${options?.seconds}s`
      }
      if (key === 'message.tools.placeholder.prepare.footer.copy') return 'Copy diagnostics'
      return key
    }
  })
}))

const { default: PrepareTimelineBlock } = await import('../PrepareTimelineBlock')

const timeline: PrepareTimeline = {
  totalMs: 6200,
  stages: [
    { stage: 'dispatch', ms: 200 },
    { stage: 'mcp-warm', ms: 3000, detail: { serverCount: 1, mcpServerName: 'filesystem' } },
    { stage: 'init-to-first-chunk', ms: 3000 }
  ],
  runtimeType: 'claude-code',
  mcpServerNames: ['filesystem']
}

describe('PrepareTimelineBlock', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders a collapsed one-line summary with the total seconds', () => {
    render(<PrepareTimelineBlock timeline={timeline} />)

    expect(screen.getByText('Response preparation took 6.2s')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-diagnostics')).toBeNull()
  })

  it('expands to a per-stage table and copies only non-sensitive diagnostics', async () => {
    mockRequest.mockResolvedValue({ version: '2.0.0' })
    Object.assign(navigator, { clipboard: { writeText: mockWriteText.mockResolvedValue(undefined) } })

    render(<PrepareTimelineBlock timeline={timeline} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('dispatch')).toBeInTheDocument()
    expect(screen.getByText('mcp-warm')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('copy-diagnostics'))
    await waitFor(() => expect(mockWriteText).toHaveBeenCalledOnce())

    const copied = mockWriteText.mock.calls[0][0] as string
    expect(JSON.parse(copied)).toMatchObject({ totalMs: 6200, appVersion: '2.0.0', agentType: 'claude-code' })
    for (const forbidden of ['apikey', 'token', 'baseurl', 'secret', 'http']) {
      expect(copied.toLowerCase()).not.toContain(forbidden)
    }
    expect(mockToastSuccess).toHaveBeenCalledOnce()
  })

  it('surfaces a copy failure via toast.error', async () => {
    mockRequest.mockRejectedValue(new Error('ipc down'))

    render(<PrepareTimelineBlock timeline={timeline} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByTestId('copy-diagnostics'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledOnce())
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
