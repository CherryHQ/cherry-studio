import type { AiPlugin } from '@cherrystudio/ai-core'

import type { AgentLoopHooks } from '../loop'
import type { RequestScope } from './scope'

export interface RequestFeature {
  /** Stable id used for error logs and (later) observability snapshots. */
  readonly name: string

  /** Activation gate. Returning false skips the entire feature for this request.
   *  Absent ⇒ always active. Errors are caught and treated as `false`. */
  applies?(scope: RequestScope): boolean

  /** AI SDK plugins for model adaptation (anthropic-cache, qwen-thinking, …).
   *  `AiPlugin<any, any>` matches the legacy PluginBuilder signature — the
   *  generic params are invariant, so concrete `AiPlugin<StreamTextParams, …>`
   *  factories don't fit the bare `AiPlugin` form. */

  contributeModelAdapters?(scope: RequestScope): AiPlugin<any, any>[]

  /** Pieces of `AgentLoopHooks`. Multiple features' same-named hooks are
   *  combined by `composeHooks` into a deterministic chain. */
  contributeHooks?(scope: RequestScope): Partial<AgentLoopHooks>
}
