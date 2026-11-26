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
    request: InterviewRequest,
    signal: AbortSignal,
    answer: (reply?: Reply) => QuestionDecision
  ): Promise<QuestionDecision>
  reviewPlan(
    request: z.infer<typeof plan>,
    signal: AbortSignal
  ): Promise<{ action: 'approve' | 'abandon' } | { action: 'revise'; feedback: string }>
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
    async function ask({ mode, ...target }: Questionnaire, signal: AbortSignal): Promise<QuestionResponse> {
      const request = { ...target, actions: mode === 'plan' ? planActions : [] }
      const result = await host.ask(request, signal, (reply) =>
        answerQuestion(request, signal.aborted ? undefined : reply)
      )
      if (result.action === 'cancel') return { outcome: 'cancelled' }
      if (result.action === 'submit')
        return {
          outcome: 'accepted',
          answers: result.answers,
          ...(result.annotations && { annotations: result.annotations })
        }
      return {
        outcome: result.action === 'discuss' ? 'chat_about_this' : 'skip_interview',
        partial_answers: result.answers
      }
    }

    async function reviewPlan(request: z.infer<typeof plan>, signal: AbortSignal): Promise<PlanResponse> {
      const decision = await host.reviewPlan(request, signal)
      if (signal.aborted || decision.action === 'abandon') return { outcome: 'abandoned' }
      if (decision.action === 'revise') return { outcome: 'cancelled', feedback: decision.feedback }
      return { outcome: 'approved' }
    }

    for (const prefix of ['_x.ai/', 'x.ai/']) {
      onRequest(prefix + 'ask_user_question', questionnaire, ask)
      onRequest(prefix + 'exit_plan_mode', plan, reviewPlan)
    }
  }
}
