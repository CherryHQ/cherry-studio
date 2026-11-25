import * as z from 'zod'

import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

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

export const legacyCursorAcpAdapter: Required<Pick<AcpHarnessAdapter, 'register'>> = {
  register(app, host) {
    app
      .onRequest('cursor/ask_question', CursorQuestionSchema, async ({ params, signal }) => {
        if (!host.isActive()) return { outcome: { outcome: 'cancelled' } }
        const input = cursorQuestionInput(params)
        const answer = await host.approve(params.toolCallId, 'AskUserQuestion', input, signal)
        const outcome =
          answer.approved && !host.signal.aborted && !signal.aborted
            ? cursorQuestionOutcome(params, answer.updatedInput)
            : { outcome: 'cancelled' as const }
        host.result(params.toolCallId, {
          ...input,
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
      .onRequest('cursor/create_plan', CursorPlanSchema, async ({ params, signal }) => {
        if (!host.isActive()) return { outcome: { outcome: 'cancelled' } }
        host.text(`${params.plan}\n`)
        const answer = await host.approve(
          params.toolCallId,
          `ACP: ${params.name ?? 'Plan'}`,
          {
            plan: params.plan,
            localPermissionOptions: [
              { optionId: 'accept', name: 'Accept', label: 'allow', kind: 'allow_once' },
              { optionId: 'reject', name: 'Reject', label: 'deny', kind: 'reject_once' }
            ]
          },
          signal
        )
        const outcome = {
          outcome: host.signal.aborted || signal.aborted ? 'cancelled' : answer.approved ? 'accepted' : 'rejected'
        }
        host.result(params.toolCallId, outcome)
        return { outcome }
      })
  }
}
