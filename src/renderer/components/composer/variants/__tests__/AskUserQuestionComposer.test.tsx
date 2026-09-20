import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { CherryMessagePart } from '@shared/data/types/message'

import AskUserQuestionComposer, { type AskUserQuestionComposerRequest } from '../AskUserQuestionComposer'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, number>) => {
      if (key === 'agent.askUserQuestion.progress') return `${options?.current} of ${options?.total}`
      return (
        {
          'agent.askUserQuestion.close': 'Close',
          'agent.askUserQuestion.customPlaceholder': 'Enter your answer...',
          'agent.askUserQuestion.next': 'Next',
          'agent.askUserQuestion.previous': 'Previous',
          'agent.askUserQuestion.skip': 'Skip',
          'agent.askUserQuestion.submit': 'Submit'
        }[key] ?? key
      )
    }
  })
}))

const questions = [
  {
    question: 'Choose logger',
    header: 'Logger',
    options: [
      { label: 'Winston', description: 'Mature ecosystem' },
      { label: 'Pino', description: 'JSON native' }
    ],
    multiSelect: false
  },
  {
    question: 'Add context',
    header: 'Context',
    options: [{ label: 'Bunyan' }],
    multiSelect: false
  }
]

function makeRequest(requestQuestions = questions): AskUserQuestionComposerRequest {
  const part = {
    type: 'tool-AskUserQuestion',
    toolCallId: 'call-1',
    state: 'approval-requested',
    input: { questions: requestQuestions },
    approval: { id: 'approval-1' }
  } as unknown as CherryMessagePart

  return {
    messageId: 'message-1',
    toolCallId: 'call-1',
    approvalId: 'approval-1',
    input: { questions: requestQuestions },
    match: {
      part,
      state: 'approval-requested',
      toolCallId: 'call-1',
      messageId: 'message-1',
      approvalId: 'approval-1',
      input: { questions: requestQuestions }
    }
  }
}

describe('AskUserQuestionComposer', () => {
  // Unsubmitted answers are cached per approval id, so the harness must not leak
  // one test's draft into the next one.
  beforeEach(() => {
    MockCacheUtils.resetMocks()
  })

  it('keeps the full question visible instead of clamping it to one line', () => {
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    const heading = screen.getByRole('heading', { name: 'Choose logger' })
    // The wrapping classes are the layout contract for the reported long-question truncation.
    expect(heading).toHaveClass('whitespace-pre-wrap', 'break-words')
    expect(heading).not.toHaveClass('line-clamp-1')
  })

  it('caps a long multiline question with vertical scrolling so answer controls stay reachable', () => {
    const longQuestion = [
      'Which logging approach should the agent use for this multi-service workspace?',
      'Please consider structured JSON output, rotation, and how traces should correlate across the renderer and main process.',
      'The answer will be applied to every new session, so pick the option that stays readable when the composer dock is only 150px tall.'
    ].join('\n')

    render(
      <AskUserQuestionComposer
        request={makeRequest([
          {
            question: longQuestion,
            header: 'Logger',
            options: [
              { label: 'Winston', description: 'Mature ecosystem' },
              { label: 'Pino', description: 'JSON native' }
            ],
            multiSelect: false
          }
        ])}
        onRespond={vi.fn()}
      />
    )

    const heading = screen.getByRole('heading', { name: longQuestion })
    expect(heading).toHaveClass('whitespace-pre-wrap', 'break-words', 'max-h-36', 'overflow-y-auto')
    expect(heading).not.toHaveClass('line-clamp-1')
    expect(screen.getByRole('button', { name: /Winston/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('marks the root panel as a composer viewport inset target', () => {
    const { container } = render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(container.firstElementChild).toHaveAttribute('data-composer-viewport-inset-target', '')
  })

  it('auto advances after option selection and submits a custom input as an answer option', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))

    expect(screen.getByText('Add context')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Enter your answer...'), {
      target: { value: 'Use JSON logs' }
    })
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true,
      updatedInput: {
        questions,
        answers: {
          'Choose logger': 'Winston',
          'Add context': 'Use JSON logs'
        }
      }
    })
  })

  it('preserves selected options when navigating back after auto advance', () => {
    const onRespond = vi.fn()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    const winston = screen.getByRole('button', { name: /Winston/ })
    fireEvent.click(winston)

    expect(screen.getByText('Add context')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByRole('button', { name: /Winston/ })).toHaveAttribute('aria-pressed', 'true')
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('submits the final selected option when earlier questions were skipped', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByText('Skip'))
    expect(screen.getByText('Add context')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Bunyan/ }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true,
      updatedInput: {
        questions,
        answers: {
          'Add context': 'Bunyan'
        }
      }
    })
  })

  it('restores unsubmitted answers after a remount', () => {
    const view = render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.change(screen.getByPlaceholderText('Enter your answer...'), { target: { value: 'Use JSON logs' } })

    view.unmount()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByText('Add context')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter your answer...')).toHaveValue('Use JSON logs')
    expect(screen.getByRole('button', { name: /Bunyan/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByRole('button', { name: /Winston/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the cached answers after a successful approval so a remount before terminal persistence restores them', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const view = render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.click(screen.getByRole('button', { name: /Bunyan/ }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))

    // The dispatch ack does not mean the approval turn is durably persisted yet,
    // so the draft must survive a fast session switch and remount.
    view.unmount()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByText('Add context')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bunyan/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops the cached answers once a dismissal is sent', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const view = render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))

    view.unmount()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Choose logger' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Winston/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the cached answers when the response fails and restores them on the next mount', async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error('transport down'))
    const view = render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.click(screen.getByRole('button', { name: /Bunyan/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('agent.toolPermission.error.sendFailed'))

    view.unmount()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn().mockResolvedValue(undefined)} />)

    expect(screen.getByRole('button', { name: /Bunyan/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('disables controls while the final response is submitting', async () => {
    const onRespond = vi.fn(() => new Promise<void>(() => undefined))
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.click(screen.getByRole('button', { name: /Bunyan/ }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: /Bunyan/ })).toBeDisabled())
  })
})
