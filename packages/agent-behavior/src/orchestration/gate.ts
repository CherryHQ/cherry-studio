import { answerVerdict, ASK_WITHDRAWN, decideApproval, repeatBlock } from '../core/approval/approval'
import { offloadPlan } from '../core/context/offload'
import type { ToolCallFact } from '../core/facts'
import type { CallRef } from '../core/hostFacts'
import { keys } from '../core/keys'
import type { GateHandlers } from '../ports/harness'
import type { HostPorts } from '../ports/host'
import { storedMarker } from './output'

/** H9: before a call, D8's block half, then approvals and the plan gate (D34, D35, D37); after it, offload (D31). */
export function gateHandlers(host: HostPorts): GateHandlers {
  return {
    async before(call, facts, ports) {
      const repeated = repeatBlock(call, facts)
      if (repeated !== undefined) return { block: repeated }
      const ref: CallRef = { thread: call.thread, key: call.key }
      // A gate call carries no provider call id; the host identifies the call by its `CallRef`.
      const tool: ToolCallFact = { callId: call.key, callKey: call.key, name: call.tool, args: call.args }
      const decision = decideApproval(
        call,
        await host.approvals.facts(ref, tool),
        host.settings.permissionMode(call.thread),
        host.settings.attendance(call.thread),
        facts.plan
      )
      if (decision.kind === 'block') return { block: decision.reason }
      if (decision.kind === 'allow') return decision.args === undefined ? {} : { args: decision.args }
      const request = {
        call: ref,
        tool: { ...tool, args: decision.args ?? call.args },
        presentation: decision.presentation
      }
      const answer = await ports.memory
        .remember(keys.approvalMemo(call.key), () => host.approvals.ask(request, call.signal))
        .catch((error: unknown) => {
          // A stopped turn withdraws the ask; nothing is remembered, so a rerun asks again.
          if (call.signal.aborted) return undefined
          throw error
        })
      return answer === undefined ? { block: ASK_WITHDRAWN } : answerVerdict(answer, decision.args)
    },
    async after(call, result) {
      const name = offloadPlan(call, result, host.settings.offloadThreshold())
      if (name === undefined) return undefined
      const text = await storedMarker(host, { name, content: result.text, key: call.key, tool: call.tool })
      return { ...result, text }
    }
  }
}
