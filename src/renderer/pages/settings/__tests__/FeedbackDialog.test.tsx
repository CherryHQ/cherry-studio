import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import enUs from '@renderer/i18n/locales/en-us.json'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  loggerError: vi.fn(),
  openRoute: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

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
    t: (key: string) => (enUs as Record<string, string>)[key] ?? key
  })
}))

import { FEEDBACK_GITHUB_URL, FeedbackDialog, getFeedbackAgentRoute } from '../FeedbackDialog'

function ControlledFeedbackDialog() {
  const [open, setOpen] = useState(true)
  return <FeedbackDialog open={open} onOpenChange={setOpen} />
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('FeedbackDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcRequest.mockResolvedValue({ sessionId: 'feedback-session' })
  })

  it('keeps the feedback assistant and GitHub in order without the moved report entry', () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    const agent = screen.getByRole('button', { name: /Feedback assistant/ })
    const github = screen.getByRole('button', { name: /GitHub Issue/ })

    expect(screen.queryByRole('button', { name: /Report a problem/i })).not.toBeInTheDocument()
    expect(agent.compareDocumentPosition(github)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('creates an isolated feedback session before opening the Agent route', async () => {
    render(<ControlledFeedbackDialog />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Feedback assistant/ }))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.support_session.create'))
    await waitFor(() => expect(mocks.openRoute).toHaveBeenCalledWith(getFeedbackAgentRoute('feedback-session')))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reports feedback-session creation failures without opening an empty Agent route', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('restore failed'))
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Feedback assistant/ }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(enUs['settings.about.feedback.agent_error']))
    expect(mocks.openRoute).not.toHaveBeenCalled()
  })

  it('opens the GitHub issue chooser', async () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: /GitHub Issue/ }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('system.shell.open_external_website', FEEDBACK_GITHUB_URL)
    )
  })

  it('closes before reporting GitHub issue chooser failures', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'system.shell.open_external_website') {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        return Promise.reject(new Error('open failed'))
      }
      return Promise.resolve({ sessionId: 'feedback-session' })
    })
    render(<ControlledFeedbackDialog />)

    await userEvent.setup().click(screen.getByRole('button', { name: /GitHub Issue/ }))

    await waitFor(() =>
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to open GitHub issue chooser', expect.any(Error))
    )
    expect(mocks.toastError).toHaveBeenCalledWith(enUs['settings.about.feedback.github.error'])
  })
})
