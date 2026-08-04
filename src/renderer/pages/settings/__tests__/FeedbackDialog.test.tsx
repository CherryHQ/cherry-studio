import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  language: 'en-US',
  openRoute: vi.fn(),
  toastError: vi.fn()
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
    t: (key: string) => key,
    i18n: {
      language: mocks.language,
      resolvedLanguage: mocks.language
    }
  })
}))

import {
  FEEDBACK_GITHUB_URL,
  FEEDBACK_SURVEY_URL,
  FeedbackDialog,
  getFeedbackAgentRoute,
  isChineseFeedbackLanguage
} from '../FeedbackDialog'

function ControlledFeedbackDialog() {
  const [open, setOpen] = useState(true)
  return <FeedbackDialog open={open} onOpenChange={setOpen} />
}

describe('feedback region selection', () => {
  it.each(['zh-CN', 'zh-TW'])('treats %s as Chinese', (language) => {
    expect(isChineseFeedbackLanguage(language)).toBe(true)
  })

  it.each(['en-US', 'ja-JP', 'zh-HK', undefined])('treats %s as overseas', (language) => {
    expect(isChineseFeedbackLanguage(language)).toBe(false)
  })
})

describe('FeedbackDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.language = 'en-US'
    mocks.ipcRequest.mockResolvedValue({ id: 'feedback-session' })
  })

  it.each(['zh-CN', 'zh-TW'])('shows the Feishu survey for %s', (language) => {
    mocks.language = language

    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /settings.about.feedback.survey.title/ })).toBeInTheDocument()
  })

  it.each(['en-US', 'ja-JP'])('hides the Feishu survey for %s', (language) => {
    mocks.language = language

    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /settings.about.feedback.survey.title/ })).not.toBeInTheDocument()
  })

  it('places the recommended Agent first and GitHub before the Chinese survey', () => {
    mocks.language = 'zh-CN'
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    const agent = screen.getByRole('button', { name: /settings.about.feedback.agent.title/ })
    const github = screen.getByRole('button', { name: /settings.about.feedback.github.title/ })
    const survey = screen.getByRole('button', { name: /settings.about.feedback.survey.title/ })
    const recommended = screen.getByText('settings.about.feedback.recommended')

    expect(agent.compareDocumentPosition(github)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(github.compareDocumentPosition(survey)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
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

    expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.feedback_session.create')
    await waitFor(() => expect(mocks.openRoute).toHaveBeenCalledWith(getFeedbackAgentRoute('feedback-session')))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reports feedback-session creation failures without opening an empty Agent route', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('restore failed'))
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.agent.title/ }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('settings.about.feedback.agent_error'))
    expect(mocks.openRoute).not.toHaveBeenCalled()
  })

  it('opens the Feishu survey for Chinese users', () => {
    mocks.language = 'zh-CN'
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.survey.title/ }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('system.shell.open_website', FEEDBACK_SURVEY_URL)
  })

  it('opens the GitHub issue chooser', () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /settings.about.feedback.github.title/ }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('system.shell.open_website', FEEDBACK_GITHUB_URL)
  })
})
