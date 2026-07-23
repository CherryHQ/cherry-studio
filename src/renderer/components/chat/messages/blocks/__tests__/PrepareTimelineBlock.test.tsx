import type { PrepareTimeline } from '@shared/ai/agentPrepareTimeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockRequest = vi.hoisted(() => vi.fn())
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
const mockWriteText = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mockRequest } }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: mockToastSuccess, error: mockToastError } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, number | string>) => {
      if (key === 'message.tools.placeholder.prepare.footer.summary') {
        return `Response preparation took ${options?.seconds}s`
      }
      if (key === 'message.tools.placeholder.prepare.footer.copy') return 'Copy diagnostics'
      // Stage / detail keys resolve to their last segment ("...stage.dispatch" -> "dispatch")
      if (key.startsWith('message.tools.placeholder.prepare.footer.')) return key.split('.').pop() ?? key
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

const expandTimeline = () => fireEvent.click(screen.getByRole('button', { expanded: false }))
const clickCopy = () => fireEvent.click(screen.getByRole('button', { name: /Copy diagnostics/ }))

describe('PrepareTimelineBlock', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders a collapsed one-line summary with the total seconds', () => {
    render(<PrepareTimelineBlock timeline={timeline} />)

    expect(screen.getByText('Response preparation took 6.2s')).toBeInTheDocument()
    expect(screen.queryByText('Copy diagnostics')).toBeNull()
  })

  it('expands to a per-stage table and copies only non-sensitive diagnostics', async () => {
    mockRequest.mockResolvedValue({ version: '2.0.0' })
    Object.assign(navigator, { clipboard: { writeText: mockWriteText.mockResolvedValue(undefined) } })

    render(<PrepareTimelineBlock timeline={timeline} />)
    expandTimeline()

    expect(screen.getByText('dispatch')).toBeInTheDocument()
    expect(screen.getByText('mcp-warm')).toBeInTheDocument()
    // Details render as localized notes, not raw JSON
    expect(screen.getByText(/filesystem/)).toBeInTheDocument()
    expect(screen.queryByText(/serverCount/)).toBeNull()

    clickCopy()
    await waitFor(() => expect(mockWriteText).toHaveBeenCalledOnce())

    const copied = mockWriteText.mock.calls[0][0] as string
    expect(JSON.parse(copied)).toMatchObject({ totalMs: 6200, appVersion: '2.0.0', agentType: 'claude-code' })
    for (const forbidden of [
      'filesystem',
      'mcpservername',
      'mcpservernames',
      'apikey',
      'token',
      'baseurl',
      'secret',
      'http'
    ]) {
      expect(copied.toLowerCase()).not.toContain(forbidden)
    }
    expect(mockToastSuccess).toHaveBeenCalledOnce()
  })

  it('surfaces a copy failure via toast.error', async () => {
    mockRequest.mockRejectedValue(new Error('ipc down'))

    render(<PrepareTimelineBlock timeline={timeline} />)
    expandTimeline()
    clickCopy()

    await waitFor(() => expect(mockToastError).toHaveBeenCalledOnce())
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
