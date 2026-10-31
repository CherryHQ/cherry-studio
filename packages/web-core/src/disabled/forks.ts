// Stand-ins for session forks and message edits, which copy the runtime's native session files;
// the browser runtime has none. Both reject the way the desktop does for a runtime without forks.
import { AgentSessionForkError } from '@main/ai/runtime/fork/checkpoint'

export { RuntimeForkAnchorSchema } from '@data/services/agentSessionForkContract'
export type { RuntimeForkAnchor, RuntimeForkCheckpoint } from '@data/services/agentSessionForkContract'
export { AgentSessionForkError } from '@main/ai/runtime/fork/checkpoint'
export type { RuntimeForkInput, RuntimeForkResult } from '@main/ai/runtime/fork/checkpoint'

/** Stands in for `@main/ai/agentSession/fork`'s operations, which `AgentSessionRuntimeService` owns. */
export class AgentSessionForkOperations {
  readonly edits = new Map<string, { operationId: string; controller: AbortController; promise: Promise<unknown> }>()
  readonly pending = new Map<
    string,
    { sourceSessionId: string; operationId: string; promise: Promise<string>; controller: AbortController }
  >()

  edit(): Promise<never> {
    return Promise.reject(new AgentSessionForkError('unsupported_checkpoint'))
  }

  fork(): Promise<never> {
    return Promise.reject(new AgentSessionForkError('unsupported_checkpoint'))
  }

  async cancel(): Promise<void> {}

  async recover(): Promise<void> {}
}
