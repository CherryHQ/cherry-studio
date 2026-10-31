import { randomUUID } from 'node:crypto'

import type { HookCallback, HookEvent, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'

import { loggerService } from '@logger'
import { PromptBuilder } from '@main/ai/agents/prompt'

import {
  buildIdentityDelivery,
  CLAUDE_IDENTITY_HOOK_SLOTS,
  CLAUDE_IDENTITY_NOMINAL_CAPACITY_UNITS,
  type IdentityDelivery
} from './identityChunks'

const logger = loggerService.withContext('ClaudeCodeIdentityHooks')
type IdentityEvent = 'SessionStart' | 'UserPromptSubmit'
type Batch = {
  key: string
  generation: number
  seenSlots: Set<number>
  signals: AbortSignal[]
  settled: number
  cancelled: boolean
  failed: boolean
  snapshot?: string
  delivery?: IdentityDelivery
  ready: Promise<void>
}

/** Per-connection identity delivery; SessionStart also runs after native context compaction. */
export function createClaudeCodeIdentityHooks(
  agentDataPath: string
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const builder = new PromptBuilder()
  const batches = new Map<IdentityEvent, Batch>()
  let generation = 0
  let delivered: string | undefined
  let warnedSnapshot: string | undefined

  function createSlotCallback(event: IdentityEvent, slot: number): HookCallback {
    return async (input, _toolUseId, { signal }) => {
      if (input.hook_event_name !== event || input.agent_id) return {}
      const key = JSON.stringify([
        input.session_id,
        input.prompt_id,
        event,
        'source' in input ? input.source : undefined
      ])
      let batch = batches.get(event)
      // The SDK has no shared event-instance ID: late slots of overlapping same-key events are indistinguishable.
      if (!batch || batch.key !== key || batch.seenSlots.has(slot)) {
        batch = {
          key,
          generation: ++generation,
          seenSlots: new Set(),
          signals: [],
          settled: 0,
          cancelled: false,
          failed: false,
          ready: Promise.resolve()
        }
        batches.set(event, batch)
        const current = batch
        // Claim the batch synchronously before the shared read starts, including for already-aborted slots.
        current.ready = Promise.resolve().then(async () => {
          current.snapshot = await builder.buildMemoriesSection(agentDataPath)
          if (current.signals.some((s) => s.aborted)) current.cancelled = true
          if (current.cancelled || (event === 'UserPromptSubmit' && current.snapshot === delivered)) return
          current.delivery = buildIdentityDelivery(current.snapshot, agentDataPath, randomUUID())
        })
      }
      const current = batch
      current.seenSlots.add(slot)
      current.signals.push(signal)
      if (signal.aborted) current.cancelled = true
      try {
        await current.ready
        if (signal.aborted) current.cancelled = true
        // Parts already returned to the SDK cannot be recalled when another slot is subsequently cancelled.
        if (current.cancelled || current.delivery?.kind !== 'ready') return {}
        const context = current.delivery.contexts[slot]
        return context ? { hookSpecificOutput: { hookEventName: event, additionalContext: context } } : {}
      } catch (error) {
        current.failed = true
        throw error
      } finally {
        current.settled++
        if (current.settled === CLAUDE_IDENTITY_HOOK_SLOTS) {
          const delivery = current.delivery
          if (
            current.generation === generation &&
            !current.failed &&
            !current.cancelled &&
            !current.signals.some((s) => s.aborted) &&
            delivery
          ) {
            if (delivery.kind === 'unrepresentable' || delivery.truncated) {
              if (warnedSnapshot !== current.snapshot) {
                logger.warn('Claude Code identity exceeds hook delivery capacity', {
                  event,
                  snapshotUnits: current.snapshot!.length,
                  nominalCapacityUnits: CLAUDE_IDENTITY_NOMINAL_CAPACITY_UNITS,
                  deliveredUnits: delivery.kind === 'ready' ? delivery.deliveredUnits : 0,
                  omittedUnits: delivery.kind === 'ready' ? delivery.omittedUnits : current.snapshot!.length,
                  hookSlots: CLAUDE_IDENTITY_HOOK_SLOTS
                })
              }
            }
            // Delivered means every local callback prepared its return, not acknowledgement from the CLI/model.
            if (delivery.kind === 'ready') {
              delivered = current.snapshot
              warnedSnapshot = current.snapshot
            }
          }
          if (batches.get(event) === current) batches.delete(event)
        }
      }
    }
  }

  return {
    SessionStart: [
      {
        hooks: Array.from({ length: CLAUDE_IDENTITY_HOOK_SLOTS }, (_, slot) => createSlotCallback('SessionStart', slot))
      }
    ],
    UserPromptSubmit: [
      {
        hooks: Array.from({ length: CLAUDE_IDENTITY_HOOK_SLOTS }, (_, slot) =>
          createSlotCallback('UserPromptSubmit', slot)
        )
      }
    ]
  }
}
