import type { JsonValue } from '@cherrystudio/agent-runtime'

import { booleanField, fieldsOf, stringField } from '../args'
import type { ConversationFacts, ToolResultFact } from '../facts'
import type { QuestionAnswer, QuestionItem, QuestionOption } from '../hostFacts'

/** Claude Code's name: Cherry's composer, card and remote access match on this raw name. */
export const ASK_USER_TOOL_NAME = 'AskUserQuestion'
const DECLINED = 'The user dismissed the questions without answering.'
const UNAVAILABLE =
  'No one can answer questions in this session (for example a channel or scheduled run), so proceed without asking the user and state your assumptions instead.'
const CANCELLED = 'The questions were withdrawn because the turn was aborted.'

const options = (value: JsonValue | undefined): QuestionOption[] | undefined => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return undefined
  const parsed: QuestionOption[] = []
  for (const item of value) {
    const fields = fieldsOf(item)
    const label = stringField(fields, 'label')
    const description = stringField(fields, 'description')
    const preview = stringField(fields, 'preview')
    if (label === undefined || description === undefined) return undefined
    parsed.push({ label, description, ...(preview === undefined ? {} : { preview }) })
  }
  return parsed
}
function questionsOf(args: JsonValue | undefined): QuestionItem[] | undefined {
  const list = fieldsOf(args)?.questions
  if (!Array.isArray(list) || list.length < 1 || list.length > 4) return undefined
  const parsed: QuestionItem[] = []
  for (const item of list) {
    const fields = fieldsOf(item)
    const question = stringField(fields, 'question')
    const header = stringField(fields, 'header')
    const choices = options(fields?.options)
    if (question === undefined || header === undefined || !choices) return undefined
    parsed.push({ question, header, options: choices, multiSelect: booleanField(fields, 'multiSelect') ?? false })
  }
  return parsed
}

/** What a call asks once validated (D28): the person, or nobody inside a subagent; an invalid call is an error result. */
export type AskDecision =
  | { readonly kind: 'ask'; readonly questions: readonly QuestionItem[] }
  | { readonly kind: 'answered'; readonly result: ToolResultFact }

export function decideAskUser(lineage: ConversationFacts['lineage'], args: JsonValue | undefined): AskDecision {
  const questions = questionsOf(args)
  const invalid = (text: string): AskDecision => ({ kind: 'answered', result: { text, isError: true } })
  if (!questions) return invalid('AskUserQuestion needs 1-4 questions, each with a question, a header and 2-4 options.')
  // Answers are keyed by question text and name the chosen labels.
  if (new Set(questions.map((item) => item.question)).size !== questions.length)
    return invalid('Each question must have a different question text.')
  if (questions.some(({ options: list }) => new Set(list.map((option) => option.label)).size !== list.length))
    return invalid('Each option of a question must have a different label.')
  // A subagent works for another agent; no person is there to answer.
  if (lineage.kind === 'subagent')
    return { kind: 'answered', result: askUserResult(questions, { status: 'unavailable' }) }
  return { kind: 'ask', questions }
}

function answeredText(questions: readonly QuestionItem[], answer: Extract<QuestionAnswer, { status: 'answered' }>) {
  const lines = questions.map(({ question }) => {
    // Own keys only: a question may be named like an Object.prototype member ("constructor").
    const value = Object.hasOwn(answer.answers, question) ? answer.answers[question] : undefined
    if (value === undefined) return `"${question}" = (not answered)`
    const notes =
      answer.annotations && Object.hasOwn(answer.annotations, question)
        ? answer.annotations[question]?.notes?.trim()
        : undefined
    return `"${question}" = "${value}"${notes ? ` (user notes: ${notes})` : ''}`
  })
  return ['The user answered your questions:', ...lines, "Continue with the user's answers in mind."].join('\n')
}

/** D29: what the model reads; `details` keep the questions for the card whatever the outcome; `undefined` = aborted. */
export function askUserResult(questions: readonly QuestionItem[], answer: QuestionAnswer | undefined): ToolResultFact {
  const unanswered = (text: string, outcome: 'declined' | 'unavailable' | 'aborted'): ToolResultFact => ({
    text,
    isError: true,
    details: { questions, answers: {}, outcome }
  })
  switch (answer?.status) {
    case undefined:
      return unanswered(CANCELLED, 'aborted')
    case 'unavailable':
      return unanswered(UNAVAILABLE, 'unavailable')
    case 'declined': {
      const feedback = answer.feedback?.trim()
      return unanswered(
        feedback
          ? `${DECLINED} They said:\n${feedback}`
          : `${DECLINED} Wait for the user's instructions instead of asking again.`,
        'declined'
      )
    }
    case 'answered':
      return {
        text: answeredText(questions, answer),
        isError: false,
        details: {
          questions,
          answers: answer.answers,
          outcome: 'answered',
          ...(answer.annotations === undefined ? {} : { annotations: answer.annotations })
        }
      }
  }
}
