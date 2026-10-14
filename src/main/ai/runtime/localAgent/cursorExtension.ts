import type { ClientApp } from '@agentclientprotocol/sdk'
import * as z from 'zod'

import type { DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'

const CursorQuestionSchema = z.object({
  toolCallId: z.string(),
  title: z.string().optional(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        allowMultiple: z.boolean().optional(),
        options: z.array(z.object({ id: z.string(), label: z.string() })).min(1)
      })
    )
    .min(1)
})

const CursorPlanSchema = z.object({
  toolCallId: z.string(),
  name: z.string().optional(),
  plan: z.string()
})

function cursorQuestionInput(params: z.infer<typeof CursorQuestionSchema>) {
  return {
    choiceOnly: true,
    questions: params.questions.map((question) => ({
      id: question.id,
      question: question.prompt,
      header: params.title ?? question.prompt,
      options: question.options,
      multiSelect: question.allowMultiple ?? false
    }))
  }
}

function cursorQuestionOutcome(params: z.infer<typeof CursorQuestionSchema>, input: unknown) {
  const selected = z.object({ answerSelections: z.record(z.string(), z.array(z.string())) }).safeParse(input)
  if (!selected.success) return { outcome: 'cancelled' as const }
  const answers: Array<{ questionId: string; selectedOptionIds: string[] }> = []
  for (const question of params.questions) {
    const ids = selected.data.answerSelections[question.id] ?? []
    if (
      (!question.allowMultiple && ids.length > 1) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !question.options.some((option) => option.id === id))
    )
      return { outcome: 'cancelled' as const }
    if (ids.length) answers.push({ questionId: question.id, selectedOptionIds: ids })
  }
  return answers.length ? { outcome: 'answered' as const, answers } : { outcome: 'skipped' as const }
}

export function registerCursorExtension(
  app: ClientApp,
  host: {
    isActive(): boolean
    signal: AbortSignal
    approve(id: string, name: string, input: Record<string, unknown>): Promise<DispatchDecision>
    text(text: string): void
    result(id: string, output: unknown): void
  }
) {
  app
    .onRequest('cursor/ask_question', CursorQuestionSchema, async ({ params }) => {
      if (!host.isActive()) return { outcome: { outcome: 'cancelled' } }
      const answer = await host.approve(params.toolCallId, 'AskUserQuestion', cursorQuestionInput(params))
      const outcome =
        answer.approved && !host.signal.aborted
          ? cursorQuestionOutcome(params, answer.updatedInput)
          : { outcome: 'cancelled' as const }
      host.result(params.toolCallId, {
        ...cursorQuestionInput(params),
        answers:
          outcome.outcome === 'answered'
            ? Object.fromEntries(
                outcome.answers.map((answer) => [
                  answer.questionId,
                  answer.selectedOptionIds
                    .map(
                      (id) =>
                        params.questions
                          .find((question) => question.id === answer.questionId)!
                          .options.find((option) => option.id === id)!.label
                    )
                    .join(', ')
                ])
              )
            : {},
        cursorOutcome: outcome
      })
      return { outcome }
    })
    .onRequest('cursor/create_plan', CursorPlanSchema, async ({ params }) => {
      if (!host.isActive()) return { outcome: { outcome: 'cancelled' } }
      host.text(`${params.plan}\n`)
      const answer = await host.approve(params.toolCallId, `ACP: ${params.name ?? 'Plan'}`, {
        plan: params.plan,
        localPermissionOptions: [
          { optionId: 'accept', name: 'Accept', label: 'allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', label: 'deny', kind: 'reject_once' }
        ]
      })
      const outcome = { outcome: host.signal.aborted ? 'cancelled' : answer.approved ? 'accepted' : 'rejected' }
      host.result(params.toolCallId, outcome)
      return { outcome }
    })
}
