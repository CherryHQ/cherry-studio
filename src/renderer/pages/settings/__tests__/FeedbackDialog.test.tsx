import '@testing-library/jest-dom/vitest'

import { POPUP_EXIT_MS } from '@renderer/services/popup'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  loggerError: vi.fn(),
  openRoute: vi.fn(),
  showDoctor: vi.fn(),
  toastError: vi.fn()
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

vi.mock('@renderer/components/doctor', () => ({
  DoctorPopup: { show: (...args: unknown[]) => mocks.showDoctor(...args) }
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows diagnostics, Cherry Support, and GitHub in the requested order', () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    const diagnostics = screen.getByRole('button', { name: /settings.about.feedback.diagnostics.title/ })
    const agent = screen.getByRole('button', { name: /settings.about.feedback.agent.title/ })
    const github = screen.getByRole('button', { name: /settings.about.feedback.github.title/ })
    const recommended = screen.getByText('settings.about.feedback.recommended')

    expect(diagnostics.compareDocumentPosition(agent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(agent.compareDocumentPosition(github)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(recommended).toBeVisible()
  })

  it('creates an isolated feedback session before opening the Agent route', async () => {
    render(<ControlledFeedbackDialog />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.agent.title/ }))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.support_session.create'))
    await waitFor(() => expect(mocks.openRoute).toHaveBeenCalledWith(getFeedbackAgentRoute('feedback-session')))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes before opening the shared problem-report panel', async () => {
    vi.useFakeTimers()
    render(<ControlledFeedbackDialog />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.diagnostics.title/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.showDoctor).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(POPUP_EXIT_MS)

    expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'report' })
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
