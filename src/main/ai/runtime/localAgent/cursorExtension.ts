import * as z from 'zod'

export const CursorQuestionSchema = z.object({
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

export const CursorPlanSchema = z.object({
  toolCallId: z.string(),
  name: z.string().optional(),
  plan: z.string()
})

export function cursorQuestionInput(params: z.infer<typeof CursorQuestionSchema>) {
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

export function cursorQuestionOutcome(params: z.infer<typeof CursorQuestionSchema>, input: unknown) {
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
