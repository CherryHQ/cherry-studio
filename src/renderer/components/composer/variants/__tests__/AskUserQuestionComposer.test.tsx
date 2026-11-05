import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('keeps a 2000-character option description complete with wrapping and bounded scrolling', () => {
    const marker = 'END-OF-DESCRIPTION-22984'
    const description = `${'Consider structured logging across every service. '.repeat(50).slice(0, 2000 - marker.length)}${marker}`
    render(
      <AskUserQuestionComposer
        request={makeRequest([
          {
            ...questions[0],
            options: [
              { label: 'Winston', description },
              { label: 'Pino', description: 'JSON native' }
            ]
          }
        ])}
        onRespond={vi.fn()}
      />
    )

    const row = screen.getByRole('button', { name: /Winston/ })
    const span = within(row).getByText(description)
    // The list shrinks inside the bounded panel so every option remains reachable.
    expect.soft(row.parentElement).toHaveClass('min-h-24', 'flex-auto', 'overflow-y-auto')
    expect.soft(row.parentElement).not.toHaveClass('min-h-0')
    expect(row.parentElement).not.toHaveClass('max-h-[50vh]')
    expect(span).toHaveClass(
      'block',
      'whitespace-pre-wrap',
      'break-words',
      'font-medium',
      'text-muted-foreground',
      'text-xs',
      'leading-4'
    )
    expect(span).not.toHaveClass('truncate')
    expect.soft(span).not.toHaveClass('max-h-36')
    expect.soft(span).not.toHaveClass('overflow-y-auto')
    expect(span.textContent).toBe(description)
    expect(span.textContent).toHaveLength(2000)
    expect(span.textContent).toMatch(/END-OF-DESCRIPTION-22984$/)
  })

  it('bounds four twelve-line multi-select options in one scrollable list while retaining every control', () => {
    const options = Array.from({ length: 4 }, (_, optionIndex) => ({
      label: `Option ${optionIndex + 1}`,
      description: Array.from({ length: 12 }, (_, lineIndex) => `Option ${optionIndex + 1} line ${lineIndex + 1}`).join(
        '\n'
      )
    }))
    render(
      <AskUserQuestionComposer
        request={makeRequest([{ ...questions[0], options, multiSelect: true }, questions[1]])}
        onRespond={vi.fn()}
      />
    )

    const firstOption = screen.getByRole('button', { name: /Option 1/ })
    // The list shrinks inside the bounded panel; each description stays fully expanded.
    expect.soft(firstOption.parentElement).toHaveClass('min-h-24', 'flex-auto', 'overflow-y-auto')
    expect.soft(firstOption.parentElement).not.toHaveClass('min-h-0')
    expect(firstOption.parentElement).not.toHaveClass('max-h-[50vh]')
    for (const option of options) {
      const row = screen.getByRole('button', { name: new RegExp(option.label) })
      const span = within(row).getByText(
        (_, element) => element?.tagName === 'SPAN' && element.textContent === option.description
      )
      expect(row).toBeInTheDocument()
      expect(span.textContent).toBe(option.description)
      expect(span).not.toHaveClass('truncate')
      expect.soft(span).not.toHaveClass('max-h-36')
      expect.soft(span).not.toHaveClass('overflow-y-auto')
    }
    expect(screen.getByRole('heading', { name: 'Choose logger' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Enter your answer...' })).toBeInTheDocument()
  })

  it('preserves all twelve authored lines in an option description', () => {
    const description = Array.from({ length: 12 }, (_, index) => `Logging consideration ${index + 1}`).join('\n')
    render(
      <AskUserQuestionComposer
        request={makeRequest([
          {
            ...questions[0],
            options: [
              { label: 'Winston', description },
              { label: 'Pino', description: 'JSON native' }
            ]
          }
        ])}
        onRespond={vi.fn()}
      />
    )

    const row = screen.getByRole('button', { name: /Winston/ })
    const span = within(row).getByText(
      (_, element) => element?.tagName === 'SPAN' && element.textContent === description
    )
    expect(span.textContent).toBe(description)
    expect(span).toHaveClass('whitespace-pre-wrap')
    expect(span).not.toHaveClass('truncate')
  })

  it('allows a 256-character unbroken description token to wrap', () => {
    const description = 'x'.repeat(256)
    render(
      <AskUserQuestionComposer
        request={makeRequest([
          {
            ...questions[0],
            options: [
              { label: 'Winston', description },
              { label: 'Pino', description: 'JSON native' }
            ]
          }
        ])}
        onRespond={vi.fn()}
      />
    )

    const span = within(screen.getByRole('button', { name: /Winston/ })).getByText(description)
    expect(span.textContent).toBe(description)
    expect(span).not.toHaveClass('truncate')
    expect(span).toHaveClass('break-words')
  })

  it('keeps Space and Enter toggling a multi-select option without submitting', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(
      <AskUserQuestionComposer request={makeRequest([{ ...questions[0], multiSelect: true }])} onRespond={onRespond} />
    )

    const row = screen.getByRole('button', { name: /Winston/ })
    row.focus()
    expect(row).toHaveFocus()
    expect(row).toHaveAttribute('aria-pressed', 'false')
    await user.keyboard(' ')
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(onRespond).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(row).toHaveAttribute('aria-pressed', 'false')
    expect(onRespond).not.toHaveBeenCalled()

    await user.keyboard(' ')
    await user.click(screen.getByText('Submit'))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: true,
        updatedInput: expect.objectContaining({ answers: { 'Choose logger': 'Winston' } })
      })
    )
  })

  it('omits absent descriptions and retains the layout contract for a short single-line description', () => {
    const input = {
      questions: [
        {
          ...questions[0],
          options: [{ label: 'Winston', description: 'Mature ecosystem' }, { label: 'Pino' }]
        }
      ]
    }
    const baseRequest = makeRequest()
    const request: AskUserQuestionComposerRequest = {
      ...baseRequest,
      input,
      match: {
        ...baseRequest.match,
        input,
        part: { ...baseRequest.match.part, input } as CherryMessagePart
      }
    }
    render(<AskUserQuestionComposer request={request} onRespond={vi.fn()} />)

    const bareRow = screen.getByRole('button', { name: /Pino/ })
    expect(within(bareRow).getByText('Pino').nextElementSibling).toBeNull()
    const span = within(screen.getByRole('button', { name: /Winston/ })).getByText('Mature ecosystem')
    expect(span.textContent).toBe('Mature ecosystem')
    expect(span).toHaveClass(
      'block',
      'whitespace-pre-wrap',
      'break-words',
      'font-medium',
      'text-muted-foreground',
      'text-xs',
      'leading-4'
    )
    expect(span).not.toHaveClass('max-h-36')
    expect(span).not.toHaveClass('overflow-y-auto')
    expect(span).not.toHaveClass('truncate')
  })

  it('marks the root panel as a composer viewport inset target', () => {
    const { container } = render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(container.firstElementChild).toHaveAttribute('data-composer-viewport-inset-target', '')
  })

  it('bounds the complete panel to the stage and lets only the option list shrink', () => {
    const stage = document.createElement('div')
    stage.setAttribute('data-composer-stage', '')
    Object.defineProperty(stage, 'clientHeight', { value: 512, configurable: true })
    document.body.appendChild(stage)
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />, { container: stage })

    const headingRow = screen.getByRole('heading', { name: 'Choose logger' }).parentElement!
    const card = headingRow.parentElement!
    const list = screen.getByRole('button', { name: /Winston/ }).parentElement!
    const answerRow = screen.getByRole('button', { name: 'Skip' }).parentElement!

    // The complete-panel bound must leave the heading and growing answer outside the shrinking
    // list; when those fixed regions exhaust the budget, the panel scrolls and the list keeps
    // a readable floor instead of collapsing.
    expect(card.style.maxHeight).toBe('512px')
    expect(card).toHaveClass('flex', 'min-h-0', 'flex-col', 'overflow-y-auto', 'overscroll-contain')
    expect(card).not.toHaveClass('overflow-hidden')
    expect(list).toHaveClass('min-h-24', 'flex-auto', 'overflow-y-auto')
    expect(list).not.toHaveClass('min-h-0')
    expect(list).not.toHaveClass('max-h-[50vh]')
    expect(headingRow).toHaveClass('shrink-0')
    expect(answerRow).toHaveClass('shrink-0')
  })

  it('subtracts the root computed padding from the stage height budget', () => {
    const resizeObserver = globalThis.ResizeObserver
    vi.stubGlobal('ResizeObserver', undefined)
    try {
      const stage = document.createElement('div')
      stage.setAttribute('data-composer-stage', '')
      Object.defineProperty(stage, 'clientHeight', { value: 512, configurable: true })
      document.body.appendChild(stage)
      const { container } = render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />, {
        container: stage
      })

      const root = container.firstElementChild as HTMLElement
      root.style.paddingBottom = '18px'
      fireEvent.resize(window)

      const card = screen.getByRole('heading', { name: 'Choose logger' }).parentElement!.parentElement!
      // Root padding shares the stage budget with the card, keeping the heading inside the stage.
      expect(card.style.maxHeight).toBe('494px')
    } finally {
      vi.stubGlobal('ResizeObserver', resizeObserver)
    }
  })

  it('leaves the panel unbounded when there is no measurable stage', () => {
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    const card = screen.getByRole('heading', { name: 'Choose logger' }).parentElement!.parentElement!
    expect(card.style.maxHeight).toBe('')
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

  it('keeps the draft after a dismissal ack until the persisted decision is observed', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const view = render(<AskUserQuestionComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: /Winston/ }))
    await user.type(screen.getByPlaceholderText('Enter your answer...'), 'Keep my context')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    view.unmount()
    render(<AskUserQuestionComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByPlaceholderText('Enter your answer...')).toHaveValue('Keep my context')
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByRole('button', { name: /Winston/ })).toHaveAttribute('aria-pressed', 'true')
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
