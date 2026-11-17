import { describe, expect, it } from 'vitest'

import { askUserResult, decideAskUser } from '../../../src/core/interaction/askUser'
import { decideTodos } from '../../../src/core/interaction/todo'
import { run } from '../history'

const option = (label: string) => ({ label, description: `${label}!` })
const question = (text: string, labels = ['A', 'B']) => ({ question: text, header: 'H', options: labels.map(option) })

describe('AskUserQuestion', () => {
  // Catches answers keyed by a duplicated question or label, which the card could not tell apart.
  it('validates questions before asking anyone', () => {
    expect(decideAskUser({ kind: 'root' }, { questions: [question('Q?'), question('Q?')] })).toMatchObject({
      kind: 'answered',
      result: { isError: true }
    })
    expect(decideAskUser({ kind: 'root' }, { questions: [question('Q?', ['A', 'A'])] })).toMatchObject({
      kind: 'answered'
    })
    expect(decideAskUser({ kind: 'root' }, { questions: [question('Q?')] })).toEqual({
      kind: 'ask',
      questions: [{ ...question('Q?'), multiSelect: false }]
    })
  })

  // Catches a subagent waiting for a person who is not there.
  it('answers unavailable inside a subagent without asking', () => {
    const asked = decideAskUser(
      { kind: 'subagent', parent: 'p' as never, origin: run('x') },
      { questions: [question('Q?')] }
    )
    expect(asked).toMatchObject({ kind: 'answered', result: { details: { outcome: 'unavailable' } } })
  })

  // Catches an answer read through Object.prototype ("constructor") or notes lost from the text (D29).
  it('maps the answer for the model and the card', () => {
    const questions = [
      { ...question('constructor'), multiSelect: false },
      { ...question('Q?'), multiSelect: false }
    ]
    const answered = askUserResult(questions, {
      status: 'answered',
      answers: { 'Q?': 'A' },
      annotations: { 'Q?': { notes: ' fast ' } }
    })
    expect(answered.text).toBe(
      'The user answered your questions:\n"constructor" = (not answered)\n"Q?" = "A" (user notes: fast)\nContinue with the user\'s answers in mind.'
    )
    expect(askUserResult(questions, undefined)).toMatchObject({ isError: true, details: { outcome: 'aborted' } })
  })
})

describe('todo_write', () => {
  // Catches two todos in progress, duplicates, or untrimmed content reaching the plan pane (D30).
  it('accepts a whole list with at most one in progress', () => {
    const ok = decideTodos({
      todos: [
        { content: ' a ', status: 'in_progress' },
        { content: 'b', status: 'pending' }
      ]
    })
    expect(ok).toMatchObject({
      isError: false,
      details: { todos: [{ content: 'a' }, { content: 'b' }], counts: { inProgress: 1, pending: 1 } }
    })
    expect(
      decideTodos({
        todos: [
          { content: 'a', status: 'pending' },
          { content: 'a ', status: 'pending' }
        ]
      }).text
    ).toMatch(/duplicate/)
    expect(
      decideTodos({
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' }
        ]
      }).text
    ).toMatch(/at most one/)
  })
})
