import type { AiPlugin } from '@cherrystudio/ai-core'

import type { ToolEntry } from '../../tools/types'
import type { AgentLoopHooks } from '../loop'
import type { RequestScope } from './scope'

export interface RequestFeature {
  /** Stable id used for error logs and (later) observability snapshots. */
  readonly name: string

  /** Activation gate. Returning false skips the entire feature for this request.
   *  Absent ⇒ always active. Errors are caught and treated as `false`. */
  applies?(scope: RequestScope): boolean

  /**
   * Per-request ephemeral tool entries — exist only while this feature is
   * active and do **not** enter the global ToolRegistry. Used by skills
   * (a skill bundles a prompt section + N tools that should not show up in
   * `tool_search` when the skill isn't active) and similar dynamic shapes.
   *
   * Long-lived tools (builtin / MCP) live in `ToolRegistry` and gate via
   * `entry.applies` — they don't go through this method.
   */
  contributeTools?(scope: RequestScope): ToolEntry[]

  /**
   * One section of the system prompt. `key` is used for de-duplication and
   * for ordering when a future caller wants to override an internal section.
   */
  contributeSystemSection?(scope: RequestScope): { key: string; text: string }

  /** AI SDK plugins for model adaptation (anthropic-cache, qwen-thinking, …).
   *  `AiPlugin<any, any>` matches the legacy PluginBuilder signature — the
   *  generic params are invariant, so concrete `AiPlugin<StreamTextParams, …>`
   *  factories don't fit the bare `AiPlugin` form. */

  contributeModelAdapters?(scope: RequestScope): AiPlugin<any, any>[]

  /** Pieces of `AgentLoopHooks`. Multiple features' same-named hooks are
   *  combined by `composeHooks` into a deterministic chain. */
  contributeHooks?(scope: RequestScope): Partial<AgentLoopHooks>
}
