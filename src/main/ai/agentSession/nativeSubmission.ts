import { application } from '@application'
import type { BusyPolicy, InputState, SubmitResult, ThreadHandle } from '@cherrystudio/agent-runtime'
import type { PiDurableThreadHandle } from '@cherrystudio/agent-runtime-pi-durable'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

function checkTarget(sessionId: string, messageId: string, handle: ThreadHandle) {
  const captured = messages.readSubmission(sessionId, messageId)
  if (captured.thread.backendId !== handle.thread.backendId || captured.thread.id !== handle.thread.id) {
    throw new Error('Input handle does not match the captured native target')
  }
  return captured
}

export function recordNativeInput(sessionId: string, messageId: string, input: InputState): void {
  application.get('DbService').withWriteTx((tx) => messages.mergeSubmissionTx(tx, sessionId, messageId, input))
}

/** The lifecycle owner retains this observer and retries failed DB writes before releasing it. */
export async function observeNativeThread(sessionId: string, handle: ThreadHandle, onError: (error: unknown) => void) {
  const pending = new Map<string, InputState[]>()
  let stopped = false
  function flush() {
    for (const [id, inputs] of pending) {
      if (!messages.hasSubmission(sessionId, id)) {
        pending.delete(id)
        continue
      }
      checkTarget(sessionId, id, handle)
      application.get('DbService').withWriteTx((tx) => {
        for (const input of inputs) messages.mergeSubmissionTx(tx, sessionId, id, input)
      })
      pending.delete(id)
    }
  }
  function capture(input: InputState) {
    if (!input.inputId) return
    pending.set(input.inputId, [...(pending.get(input.inputId) ?? []), input])
    try {
      flush()
    } catch (error) {
      onError(error)
    }
  }
  const observation = await handle.observe((event) => {
    const inputs = event.type === 'snapshot' ? event.inputs : event.type === 'input.changed' ? [event.input] : []
    for (const input of inputs) capture(input)
  })
  if (observation.status !== 'confirmed') throw new Error(observation.error.message)
  return {
    flush,
    async stop() {
      stopped = true
      await observation.value.stop()
      flush()
    },
    async submit(messageId: string, contextId: string, whenBusy: BusyPolicy): Promise<SubmitResult> {
      if (stopped) throw new Error('Native input observation has stopped')
      const context = agentSessionContextService.context(contextId)
      if (
        context.sessionId !== sessionId ||
        context.backendId !== handle.thread.backendId ||
        (context.nativeThreadId ?? context.intendedThreadId) !== handle.thread.id
      ) {
        throw new Error('Input context does not match the native target')
      }
      if (!handle.input || !handle.input.policies.includes(whenBusy)) throw new Error('Input policy is unavailable')
      const draft = messages.prepareSubmission(sessionId, messageId, contextId, whenBusy)
      const kind = agentSessionContextService.backend(context.backendId).locator.kind
      const input = kind === 'pi-durable' ? { ...draft, deduplicationKey: messageId } : draft
      const result = await handle.input.submit(input)
      if (result.status === 'acknowledged') capture(result)
      return result
    }
  }
}

/** Lookup is passive: absent evidence never triggers another generation. */
export async function reconcileDurableMessage(sessionId: string, messageId: string, handle: PiDurableThreadHandle) {
  const { draft } = checkTarget(sessionId, messageId, handle)
  const result = await handle.lookupInput({ by: 'deduplication-key', key: messageId })
  if (result.status === 'confirmed' && result.value.found) {
    recordNativeInput(sessionId, messageId, { ...result.value.input, inputId: draft.inputId })
  }
  return result
}
