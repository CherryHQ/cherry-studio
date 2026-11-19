import { answerVerdict, ASK_WITHDRAWN, decideApproval, repeatBlock } from '../core/approval/approval'
import { offloadPlan } from '../core/context/offload'
import type { GateCall, ToolCallFact } from '../core/facts'
import type { ApprovalHostFacts, CallRef } from '../core/hostFacts'
import { keys } from '../core/keys'
import type { GateHandlers } from '../ports/harness'
import type { HostPorts } from '../ports/host'
import { storedMarker } from './output'

const MODE_STABLE_ATTEMPTS = 3

/** Facts gathered across a permission-mode switch would apply the old mode's command policy. */
async function currentFacts(host: HostPorts, ref: CallRef, tool: ToolCallFact): Promise<ApprovalHostFacts> {
  for (let attempt = 1; ; attempt++) {
    const facts = await host.approvals.facts(ref, tool)
    if (facts.permissionMode === undefined || facts.permissionMode === host.settings.permissionMode(ref.thread))
      return facts
    // A mode that keeps changing must not let stale facts skip a person.
    if (attempt === MODE_STABLE_ATTEMPTS) return { ...facts, approvalRequired: true }
  }
}

/** H9: before a call, D8's block half, then approvals and the plan gate (D34, D35, D37); after it, offload (D31). */
export function gateHandlers(host: HostPorts): GateHandlers {
  return {
    ...(host.fileWrites && {
      settle: (call: GateCall, isError: boolean) =>
        host.fileWrites!.settle({ thread: call.thread, callKey: call.key, tool: call.tool, args: call.args, isError })
    }),
    async before(call, facts, ports) {
      const repeated = repeatBlock(call, facts)
      if (repeated !== undefined) return { block: repeated }
      const ref: CallRef = { thread: call.thread, key: call.key }
      // A gate call carries no provider call id; the host identifies the call by its `CallRef`.
      const tool: ToolCallFact = { callId: call.key, callKey: call.key, name: call.tool, args: call.args }
      // Hosts may hand over a mutable input object; a change after the card was shown voids the grant.
      const originalArguments = JSON.stringify(call.args)
      const hostFacts = await currentFacts(host, ref, tool)
      const decision = decideApproval(
        call,
        hostFacts,
        host.settings.permissionMode(call.thread),
        host.settings.attendance(call.thread),
        facts.plan
      )
      if (decision.kind === 'block') return { block: decision.reason }
      const protect = async (verdict: { block?: string; args?: typeof call.args }) => {
        if (verdict.block !== undefined || !host.fileWrites) return verdict
        const protectedWrite = await host.fileWrites.protect({
          thread: call.thread,
          callKey: call.key,
          tool: call.tool,
          args: verdict.args ?? call.args,
          signal: call.signal
        })
        return protectedWrite.block === undefined ? verdict : { block: protectedWrite.block }
      }
      if (decision.kind === 'allow') return protect(decision.args === undefined ? {} : { args: decision.args })
      const request = {
        call: ref,
        tool: { ...tool, args: decision.args ?? call.args },
        presentation: decision.presentation,
        ...(decision.details === undefined ? {} : { details: decision.details })
      }
      const answer = await ports.memory
        .remember(keys.approvalMemo(call.key), () => host.approvals.ask(request, call.signal))
        .catch((error: unknown) => {
          // A stopped turn withdraws the ask; nothing is remembered, so a rerun asks again.
          if (call.signal.aborted) return undefined
          throw error
        })
      if (answer === undefined) return { block: ASK_WITHDRAWN }
      const verdict = answerVerdict(answer, decision.args)
      const policy = hostFacts.commandPolicy
      if (answer.kind === 'granted' && policy !== undefined) {
        const args = answer.args ?? decision.args ?? call.args
        const latest = await currentFacts(host, ref, { ...tool, args })
        const checked = decideApproval(
          { ...call, args },
          latest,
          host.settings.permissionMode(call.thread),
          host.settings.attendance(call.thread),
          facts.plan
        )
        if (checked.kind === 'block') return { block: checked.reason }
        if (
          latest.commandPolicy?.context !== policy.context ||
          JSON.stringify(call.args) !== originalArguments ||
          (latest.rewrittenArgs !== undefined && JSON.stringify(latest.rewrittenArgs) !== JSON.stringify(args))
        )
          return { block: policy.changedReason }
      }
      return protect(verdict)
    },
    async after(call, result) {
      if (host.fileWrites)
        await host.fileWrites.settle({
          thread: call.thread,
          callKey: call.key,
          tool: call.tool,
          args: call.args,
          isError: result.isError
        })
      const name = offloadPlan(call, result, host.settings.offloadThreshold())
      if (name === undefined) return undefined
      const text = await storedMarker(host, { name, content: result.text, key: call.key, tool: call.tool })
      return { ...result, text }
    }
  }
}
