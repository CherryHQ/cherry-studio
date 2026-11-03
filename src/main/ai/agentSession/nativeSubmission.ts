import { application } from '@application'
import { runtimeId, type BusyPolicy, type InputDraft } from '@cherrystudio/agent-runtime'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

function submissionDraft(message: AgentSessionMessageRow, whenBusy: BusyPolicy): InputDraft {
  if (!message.data.parts?.length) throw new Error('Native submission requires message content')
  const text = message.data.parts
    .map((part) => {
      if (part.type !== 'text') throw new Error('Native submission currently requires text-only message content')
      return part.text
    })
    .join('\n')
  return { inputId: runtimeId(message.id), text, whenBusy }
}

export function prepareNativeSubmission(
  sessionId: string,
  messageId: string,
  contextId: string,
  whenBusy: BusyPolicy
): InputDraft {
  return application.get('DbService').withWriteTx((tx) => {
    const message = messages.prepareSubmissionTx(tx, sessionId, messageId, contextId, whenBusy)
    return submissionDraft(message, whenBusy)
  })
}
