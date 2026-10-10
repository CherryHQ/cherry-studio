import { Type } from '@earendil-works/pi-ai'
import type { AgentToolResult, ExtensionFactory } from '@earendil-works/pi-coding-agent'

/** Claude Code's name: Cherry's composer, card and remote access match on this raw name. */
export const ASK_USER_TOOL_NAME = 'AskUserQuestion'

export interface AskUserQuestionOption {
  label: string
  description: string
  preview?: string
}

export interface AskUserQuestionItem {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

/** Keyed by question text, like Claude Code's `answers`. */
export type AskUserAnnotations = Record<string, { notes?: string }>

export interface AskUserRequest {
  toolCallId: string
  questions: readonly AskUserQuestionItem[]
  /** Aborts when the turn does; the host should withdraw the question then. */
  signal: AbortSignal
}

export type AskUserResponse =
  /** Answers keyed by question text (multi-select answers comma-separated); unanswered questions are left out. */
  | { status: 'answered'; answers: Record<string, string>; annotations?: AskUserAnnotations }
  | { status: 'declined'; feedback?: string }
  /** Nobody can answer, e.g. a channel or scheduled run. */
  | { status: 'unavailable' }

/** Host side of `AskUserQuestion`: shows the questions and resolves with the user's response. */
export interface AskUserPort {
  /** Should settle when `signal` aborts; the tool stops waiting on abort either way. */
  ask(request: AskUserRequest): Promise<AskUserResponse>
}

/**
 * `details` of every result the tool returns (answered, declined, unavailable or aborted), in the shape
 * Cherry's card reads. Calls Pi rejects before `execute`, or that throw, carry empty `details`.
 */
export interface AskUserQuestionDetails {
  questions: AskUserQuestionItem[]
  answers: Record<string, string>
  annotations?: AskUserAnnotations
}

const DESCRIPTION = [
  'Ask the user one to four multiple-choice questions and wait for the answers. Use it to gather preferences or',
  'requirements, clarify ambiguous instructions, or get a decision between approaches while you work.',
  '- The user can always type their own answer, so do not add an "Other" option.',
  '- Set multiSelect to true to allow several answers to one question.',
  '- If you recommend an option, list it first and add "(Recommended)" to its label.'
].join('\n')

const DECLINED = 'The user dismissed the questions without answering.'
const UNAVAILABLE =
  'No one can answer questions in this session (for example a channel or scheduled run), so proceed without asking the user and state your assumptions instead.'
const CANCELLED = 'The questions were withdrawn because the turn was aborted.'

const parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String({
        description:
          'The complete question, clear and specific, ending with a question mark. If multiSelect is true, phrase it accordingly.'
      }),
      header: Type.String({
        description: 'Very short label displayed as a chip (max 12 chars), e.g. "Auth method", "Library".'
      }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ description: 'The text the user selects: concise, 1-5 words.' }),
          description: Type.String({ description: 'What this option means or what happens if it is chosen.' }),
          preview: Type.Optional(
            Type.String({ description: 'Content shown while the option is focused, e.g. a mockup or code snippet.' })
          )
        }),
        { minItems: 2, maxItems: 4, description: '2-4 distinct choices, mutually exclusive unless multiSelect is set.' }
      ),
      multiSelect: Type.Optional(
        Type.Boolean({ description: 'Allow the user to select several options. Default false.' })
      )
    }),
    { minItems: 1, maxItems: 4, description: 'Questions to ask the user (1-4).' }
  )
})

function answeredText(
  questions: readonly AskUserQuestionItem[],
  response: Extract<AskUserResponse, { status: 'answered' }>
) {
  const lines = questions.map(({ question }) => {
    const answer = response.answers[question]
    if (answer === undefined) return `"${question}" = (not answered)`
    const notes = response.annotations?.[question]?.notes?.trim()
    return `"${question}" = "${answer}"${notes ? ` (user notes: ${notes})` : ''}`
  })
  return ['The user answered your questions:', ...lines, "Continue with the user's answers in mind."].join('\n')
}

/** What the model reads; `details` keep the questions for the UI whatever the outcome. `undefined` = aborted. */
function toToolResult(
  questions: AskUserQuestionItem[],
  response: AskUserResponse | undefined
): AgentToolResult<AskUserQuestionDetails> {
  const unanswered = (text: string) => ({
    content: [{ type: 'text' as const, text }],
    details: { questions, answers: {} },
    isError: true
  })
  switch (response?.status) {
    case undefined:
      return unanswered(CANCELLED)
    case 'unavailable':
      return unanswered(UNAVAILABLE)
    case 'declined': {
      const feedback = response.feedback?.trim()
      return unanswered(
        feedback
          ? `${DECLINED} They said:\n${feedback}`
          : `${DECLINED} Wait for the user's instructions instead of asking again.`
      )
    }
    case 'answered': {
      const { answers, annotations } = response
      return {
        content: [{ type: 'text', text: answeredText(questions, response) }],
        details: { questions, answers, ...(annotations === undefined ? {} : { annotations }) }
      }
    }
  }
}

/** Waits for the port, or resolves `undefined` as soon as `signal` aborts. */
async function waitForAnswer(port: AskUserPort, request: AskUserRequest): Promise<AskUserResponse | undefined> {
  const { signal } = request
  if (signal.aborted) return undefined
  let onAbort!: () => void
  const aborted = new Promise<undefined>((resolve) => (onAbort = () => resolve(undefined)))
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([port.ask(request), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * The `AskUserQuestion` tool with Claude Code's input schema. It waits on `port`; calls in one
 * model step run one at a time, so the user sees one set of questions at a time.
 */
export function createAskUserExtension(port: AskUserPort): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: ASK_USER_TOOL_NAME,
      label: 'Ask user',
      description: DESCRIPTION,
      parameters,
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute(toolCallId, params, signal) {
        const questions = params.questions.map((item) => ({ ...item, multiSelect: item.multiSelect ?? false }))
        const texts = new Set(questions.map((item) => item.question))
        // Answers are keyed by question text and name the chosen labels.
        if (texts.size !== questions.length) throw new Error('Each question must have a different question text.')
        if (questions.some(({ options }) => new Set(options.map((option) => option.label)).size !== options.length))
          throw new Error('Each option of a question must have a different label.')

        const request = { toolCallId, questions, signal: signal ?? new AbortController().signal }
        return toToolResult(questions, await waitForAnswer(port, request))
      }
    })
  }
}
