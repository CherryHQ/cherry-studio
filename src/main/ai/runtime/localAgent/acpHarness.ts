import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'
import { createGrokAcpAdapter } from '@cherrystudio/agent-runtime-grok-acp'
import { piAcpAdapter } from '@cherrystudio/agent-runtime-pi-acp'
import type { DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { NativeQuestionReplySchema } from '@shared/ai/nativeInteraction'

type RequestDecision = <T>(
  target: { sessionId: string; toolCallId: string },
  tool: 'AskUserQuestion' | 'ExitPlanMode',
  input: Record<string, unknown>,
  signal: AbortSignal,
  settle: (decision: DispatchDecision) => { reply: T; output: unknown }
) => Promise<T>

export function localAcpHarness(presetId: string | undefined, decide: RequestDecision): AcpHarnessAdapter | undefined {
  switch (presetId) {
    case 'pi-acp':
      return piAcpAdapter
    case 'grok-build':
      return createGrokAcpAdapter({
        ask(request, signal, answer) {
          const questions = request.questions.map(({ question, options, multiSelect }) => ({
            question,
            header: question,
            multiSelect: multiSelect === true,
            options: options.map(({ label, description, preview }) => ({
              label,
              description: [description, preview].filter(Boolean).join('\n')
            }))
          }))
          const input = { questions, ...(request.actions.length && { interviewActions: request.actions }) }
          return decide<ReturnType<typeof answer>>(request, 'AskUserQuestion', input, signal, (decision) => {
            const selection = decision.approved
              ? NativeQuestionReplySchema.safeParse(decision.updatedInput).data
              : undefined
            const reply = answer(selection)
            if (reply.action === 'cancel') return { reply, output: { approved: false } }
            if (reply.action !== 'submit')
              return { reply, output: { questions, answers: reply.answers, interviewAction: reply.action } }
            const answers = Object.fromEntries(
              questions.flatMap(({ question }, index) => {
                if (!Object.hasOwn(reply.answers, question)) return []
                const notes = reply.annotations?.[question]?.notes
                const freeform = selection?.action === 'submit' && !selection.selections[index].selected.length
                return [[question, freeform && notes ? notes : reply.answers[question].join(', ')]]
              })
            )
            return { reply, output: { questions, answers, annotations: reply.annotations } }
          })
        },
        async reviewPlan(request, signal) {
          const decision = await decide(
            request,
            'ExitPlanMode',
            { plan: request.planContent ?? '' },
            signal,
            (reply) => ({ reply, output: { approved: reply.approved, reason: reply.reason } })
          )
          if (decision.approved) return { action: 'approve' }
          if (decision.reasonSource === 'user' && decision.reason?.trim())
            return { action: 'revise', feedback: decision.reason }
          return { action: 'abandon' }
        }
      })
    default:
      return undefined
  }
}
