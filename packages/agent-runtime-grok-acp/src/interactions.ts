import * as z from 'zod'

import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

const target = z.object({ sessionId: z.string().min(1), toolCallId: z.string().min(1) })
const question = z.object({
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string(), description: z.string().nullish(), preview: z.string().nullish() })),
  multiSelect: z.boolean().nullish()
})
const questionnaire = target.extend({
  mode: z.enum(['default', 'plan']).default('default'),
  // Grok keys its answers by question text.
  questions: z
    .array(question)
    .min(1)
    .refine((items) => new Set(items.map((item) => item.question)).size === items.length)
})
const plan = target.extend({ planContent: z.string().nullish() })

type RequestTarget = z.infer<typeof target>
type Questionnaire = z.infer<typeof questionnaire>
const planActions = ['discuss', 'skip-interview'] as const
type InterviewAction = (typeof planActions)[number]
type InterviewRequest = Omit<Questionnaire, 'mode'> & { actions: readonly InterviewAction[] }
type Reply =
  | { action: 'submit'; selections: Array<{ selected: string[]; notes?: string }> }
  | { action: InterviewAction; selections: Array<{ selected: string[]; freeform?: true }> }

type AnswerSet = {
  answers: Record<string, string[]>
  annotations?: Record<string, { notes?: string; preview?: string }>
}
type QuestionDecision =
  | { action: 'cancel' }
  | ({ action: 'submit' } & AnswerSet)
  | { action: InterviewAction; answers: Record<string, string> }

type QuestionResponse =
  | { outcome: 'cancelled' }
  | ({ outcome: 'accepted' } & AnswerSet)
  | { outcome: 'chat_about_this' | 'skip_interview'; partial_answers: Record<string, string> }

type PlanResponse = { outcome: 'approved' | 'abandoned' } | { outcome: 'cancelled'; feedback: string }

export interface GrokInteractionHost {
  ask(
    target: RequestTarget,
    input: ReturnType<typeof questionInput>,
    signal: AbortSignal,
    settle: (selection?: Reply) => { reply: QuestionResponse; output: unknown }
  ): Promise<QuestionResponse>
  reviewPlan(
    target: RequestTarget,
    input: { plan: string },
    signal: AbortSignal
  ): Promise<{ approved: boolean; reason?: string; reasonSource?: 'user' }>
}

function questionInput(request: InterviewRequest) {
  const questions = request.questions.map(({ question, options, multiSelect }) => ({
    question,
    header: question,
    multiSelect: multiSelect === true,
    options: options.map(({ label, description, preview }) => ({
      label,
      description: [description, preview].filter(Boolean).join('\n')
    }))
  }))
  return { questions, ...(request.actions.length > 0 && { interviewActions: request.actions }) }
}

function answerQuestion(request: InterviewRequest, reply?: Reply): QuestionDecision {
  if (
    !reply ||
    reply.selections.length !== request.questions.length ||
    (reply.action !== 'submit' && !request.actions.includes(reply.action))
  )
    return { action: 'cancel' }
  const answers: Array<[string, string[]]> = []
  const annotations: Array<[string, { notes?: string; preview?: string }]> = []
  for (const [index, { question, options, multiSelect }] of request.questions.entries()) {
    const selection = reply.selections[index]
    const unmatched = new Set(selection.selected)
    const chosen = options.filter(({ label }) => unmatched.delete(label))
    if (unmatched.size || chosen.length !== selection.selected.length || (!multiSelect && chosen.length > 1))
      return { action: 'cancel' }
    const notes = 'notes' in selection ? selection.notes : undefined
    if (!chosen.length && !notes && !('freeform' in selection && selection.freeform)) continue
    answers.push([question, chosen.length ? chosen.map(({ label }) => label) : ['Other']])
    if (reply.action === 'submit') {
      const preview = !multiSelect ? chosen[0]?.preview : undefined
      if (preview || notes) annotations.push([question, { ...(preview && { preview }), ...(notes && { notes }) }])
    }
  }
  if (reply.action !== 'submit') {
    return {
      action: reply.action,
      answers: Object.fromEntries(answers.map(([question, labels]) => [question, labels.join(', ')]))
    }
  }
  return answers.length
    ? {
        action: 'submit',
        answers: Object.fromEntries(answers),
        ...(annotations.length && { annotations: Object.fromEntries(annotations) })
      }
    : { action: 'cancel' }
}

export function grokInteractions(host: GrokInteractionHost): NonNullable<AcpHarnessAdapter['registerRequests']> {
  return (onRequest) => {
    function ask({ mode, ...request }: Questionnaire, signal: AbortSignal): Promise<QuestionResponse> {
      const interview = { ...request, actions: mode === 'plan' ? planActions : [] }
      const input = questionInput(interview)
      return host.ask(request, input, signal, (selection) => {
        const decision = answerQuestion(interview, signal.aborted ? undefined : selection)
        if (decision.action === 'cancel') return { reply: { outcome: 'cancelled' }, output: { approved: false } }
        if (decision.action !== 'submit')
          return {
            reply: {
              outcome: decision.action === 'discuss' ? 'chat_about_this' : 'skip_interview',
              partial_answers: decision.answers
            },
            output: { questions: input.questions, answers: decision.answers, interviewAction: decision.action }
          }
        const answers = Object.fromEntries(
          input.questions.flatMap(({ question }, index) => {
            if (!Object.hasOwn(decision.answers, question)) return []
            const notes = decision.annotations?.[question]?.notes
            const freeform = selection?.action === 'submit' && !selection.selections[index].selected.length
            return [[question, freeform && notes ? notes : decision.answers[question].join(', ')]]
          })
        )
        return {
          reply: {
            outcome: 'accepted',
            answers: decision.answers,
            ...(decision.annotations && { annotations: decision.annotations })
          },
          output: { questions: input.questions, answers, annotations: decision.annotations }
        }
      })
    }

    async function reviewPlan(request: z.infer<typeof plan>, signal: AbortSignal): Promise<PlanResponse> {
      const decision = await host.reviewPlan(request, { plan: request.planContent ?? '' }, signal)
      if (signal.aborted) return { outcome: 'abandoned' }
      if (decision.approved) return { outcome: 'approved' }
      if (decision.reasonSource === 'user' && decision.reason?.trim())
        return { outcome: 'cancelled', feedback: decision.reason }
      return { outcome: 'abandoned' }
    }

    for (const prefix of ['_x.ai/', 'x.ai/']) {
      onRequest(prefix + 'ask_user_question', questionnaire, ask)
      onRequest(prefix + 'exit_plan_mode', plan, reviewPlan)
    }
  }
}
