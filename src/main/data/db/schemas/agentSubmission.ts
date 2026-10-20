import type { BusyPolicy, InputFact, InputState } from '@cherrystudio/agent-runtime'

/** Main-only evidence attached to the retained user message, never a second input body. */
export interface AgentSubmission {
  readonly contextId: string
  readonly whenBusy: BusyPolicy
  readonly contentHash: string
  readonly nativeInputId?: string
  readonly facts: readonly InputFact[]
  readonly outcome?: InputState['outcome']
  readonly responseMessageId?: string
}
