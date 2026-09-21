import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

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

  it('uses an auto-growing textarea so a long answer wraps instead of scrolling sideways', () => {
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    const field = screen.getByPlaceholderText('Enter your answer...')

    // A single-line input cannot wrap its value; the textarea primitive supplies the
    // auto-grow (`field-sizing-content`) and this keeps the drag handle off the field.
    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toHaveAttribute('rows', '1')
    expect(field).toHaveClass('resize-none')
  })

  it('keeps Shift+Enter inside the field and lets Enter advance', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    const field = screen.getByPlaceholderText('Enter your answer...')
    await user.click(field)
    await user.keyboard('first line{Shift>}{Enter}{/Shift}second line')

    expect(field).toHaveValue('first line\nsecond line')
    expect(onRespond).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')

    expect(screen.getByText('Add context')).toBeInTheDocument()
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('disables controls while the final response is submitting', async () => {
    const onRespond = vi.fn(() => new Promise<void>(() => undefined))
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.click(screen.getByRole('button', { name: /Bunyan/ }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: /Bunyan/ })).toBeDisabled())
  })

  it('sends a selected option and the typed note together instead of dropping the option', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    fireEvent.change(screen.getByPlaceholderText('Enter your answer...'), { target: { value: 'Use JSON logs' } })
    // A typed note on a non-final question only advances — the label must not promise a submit.
    // Matched by text: the pagination control also carries a "Next" aria-label.
    expect(screen.getByText('Next')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Add context')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Bunyan/ }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true,
      updatedInput: {
        questions,
        answers: {
          'Choose logger': 'Winston',
          'Add context': 'Bunyan'
        },
        annotations: {
          'Choose logger': { notes: 'Use JSON logs' }
        }
      }
    })
  })

  it('keeps typed text as the answer for a question without a selection', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByText('Skip'))
    fireEvent.change(screen.getByPlaceholderText('Enter your answer...'), { target: { value: 'Use JSON logs' } })
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true,
      updatedInput: {
        questions,
        answers: {
          'Add context': 'Use JSON logs'
        }
      }
    })
  })

  it('lets a single-select option be toggled off so the typed text can replace it', () => {
    const onRespond = vi.fn()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByRole('button', { name: /Winston/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /Winston/ }))

    expect(screen.getByRole('heading', { name: 'Choose logger' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Winston/ })).toHaveAttribute('aria-pressed', 'false')
    expect(onRespond).not.toHaveBeenCalled()
  })
})
