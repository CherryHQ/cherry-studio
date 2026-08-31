import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  loggerError: vi.fn(),
  openRoute: vi.fn(),
  setPreference: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [['other-agent', 'cherry-support'], mocks.setPreference]
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openRoute: (...args: unknown[]) => mocks.openRoute(...args)
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/components/feedback/DiagnosticUploadDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog">diagnostic-upload-dialog</div> : null)
}))

import { FEEDBACK_GITHUB_URL, FeedbackDialog, getFeedbackAgentRoute } from '../FeedbackDialog'

function ControlledFeedbackDialog() {
  const [open, setOpen] = useState(true)
  return <FeedbackDialog open={open} onOpenChange={setOpen} />
}

describe('FeedbackDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcRequest.mockResolvedValue({ sessionId: 'feedback-session' })
    mocks.setPreference.mockResolvedValue(undefined)
  })

  it('shows diagnostics, Cherry Support, and GitHub in the requested order', () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    const diagnostics = screen.getByRole('button', { name: /settings.about.feedback.diagnostics.title/ })
    const agent = screen.getByRole('button', { name: /settings.about.feedback.agent.title/ })
    const github = screen.getByRole('button', { name: /settings.about.feedback.github.title/ })
    const recommended = screen.getByText('settings.about.feedback.recommended')

    expect(diagnostics.compareDocumentPosition(agent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(agent.compareDocumentPosition(github)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(recommended).toHaveClass('bg-primary/10', 'text-primary')
  })

  it('uses the shared large dialog size with inset, spacious options', () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByTestId('dialog-content')).toHaveAttribute('data-size', 'lg')
    expect(screen.getByRole('list')).toHaveClass('gap-3', 'px-2')
  })

  it('creates an isolated feedback session before opening the Agent route', async () => {
    render(<ControlledFeedbackDialog />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.agent.title/ }))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.support_session.create'))
    await waitFor(() => expect(mocks.openRoute).toHaveBeenCalledWith(getFeedbackAgentRoute('feedback-session')))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('adds Cherry Support back to the task list before opening feedback', async () => {
    let finishPreferenceUpdate: (() => void) | undefined
    mocks.setPreference.mockImplementationOnce(() => new Promise<void>((resolve) => (finishPreferenceUpdate = resolve)))
    render(<ControlledFeedbackDialog />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.agent.title/ }))

    await waitFor(() => expect(mocks.setPreference).toHaveBeenCalledWith(['other-agent']))
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect(mocks.openRoute).not.toHaveBeenCalled()

    finishPreferenceUpdate?.()
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.support_session.create'))
    await waitFor(() => expect(mocks.openRoute).toHaveBeenCalledWith(getFeedbackAgentRoute('feedback-session')))
  })

  it('does not create an orphan feedback session when restoring Cherry Support fails', async () => {
    mocks.setPreference.mockRejectedValueOnce(new Error('restore failed'))
    render(<ControlledFeedbackDialog />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.agent.title/ }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('common.error'))
    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to update built-in Agent list visibility', {
      agentId: 'cherry-support',
      error: expect.any(Error),
      visible: true
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect(mocks.openRoute).not.toHaveBeenCalled()
  })

  it('opens the one-step diagnostic upload dialog', async () => {
    render(<ControlledFeedbackDialog />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.diagnostics.title/ }))

    await waitFor(() => expect(screen.getByText('diagnostic-upload-dialog')).toBeInTheDocument())
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('diagnostics.bundle.upload', expect.anything())
  })

  it('reports feedback-session creation failures without opening an empty Agent route', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('restore failed'))
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.agent.title/ }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('settings.about.feedback.agent_error'))
    expect(mocks.openRoute).not.toHaveBeenCalled()
  })

  it('opens the GitHub issue chooser', async () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.github.title/ }))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('system.shell.open_website', FEEDBACK_GITHUB_URL))
  })

  it('closes before reporting GitHub issue chooser failures', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'system.shell.open_website') {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        return Promise.reject(new Error('open failed'))
      }
      return Promise.resolve({ sessionId: 'feedback-session' })
    })
    render(<ControlledFeedbackDialog />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.github.title/ }))

    await waitFor(() =>
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to open GitHub issue chooser', expect.any(Error))
    )
    expect(mocks.toastError).toHaveBeenCalledWith('settings.about.feedback.github.error')
  })
})
