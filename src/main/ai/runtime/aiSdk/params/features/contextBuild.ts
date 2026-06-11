/**
 * Context-build feature: wires context-management middleware into the
 * AI SDK plugin chain. Ported from PR #14916 (feat/agent-context),
 * reduced to the truncate slice — compact / compress / dynamicState land
 * with the settings layer in P2.
 *
 * The feature name is intentionally library-agnostic — chef
 * (@context-chef/ai-sdk-middleware) is the implementation, but the *role*
 * is "build / shape the context the model sees on each call".
 *
 * Truncation persists the original via VfsBlobService and replaces the
 * tool result with a `<persisted-output>` marker carrying the absolute
 * file path (Claude Code's pattern) — only the outgoing prompt is
 * rewritten; stored conversation history is untouched. Entries flagged
 * `ToolEntry.truncatable === false` (citation tools) are preserved
 * verbatim via chef's `perTool` exemption.
 *
 * Compression is opt-in upstream (@context-chef/ai-sdk-middleware ≥1.4)
 * and not configured here: compressed history cannot be persisted back to
 * the topic yet, so enabling it would re-pay an LLM compression call on
 * every over-budget turn. P2 wires `compress` (default-on, current model)
 * together with the marker-message persistence.
 */
import { application } from '@application'
import { definePlugin } from '@cherrystudio/ai-core'
import type { ContextChefOptions } from '@context-chef/ai-sdk-middleware'
import { createMiddleware } from '@context-chef/ai-sdk-middleware'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

/** ~25K tokens at the typical 4:1 chars:token ratio — ordinary tool
 *  results pass through inline; only genuinely large outputs persist.
 *  (Defaults carried over from PR #14916.) */
const TRUNCATE_THRESHOLD_CHARS = 100_000
const HEAD_CHARS = 500
const TAIL_CHARS = 1_000

/** Exported for direct middleware testing. */
export function buildChefOptions(scope: RequestScope): ContextChefOptions {
  return {
    truncate: {
      threshold: TRUNCATE_THRESHOLD_CHARS,
      headChars: HEAD_CHARS,
      tailChars: TAIL_CHARS,
      storage: application.get('VfsBlobService').getAdapter(),
      // Declarative opt-out: entries flagged `truncatable: false` are
      // preserved verbatim (citation + read-style tools).
      perTool: scope.registry
        .getAll()
        .filter((entry) => entry.truncatable === false)
        .map((entry) => entry.name)
    }
  }
}

function createContextBuildPlugin(scope: RequestScope) {
  return definePlugin({
    name: 'context-build',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createMiddleware(buildChefOptions(scope)))
    }
  })
}

export const contextBuildFeature: RequestFeature = {
  name: 'context-build',
  contributeModelAdapters: (scope) => [createContextBuildPlugin(scope)]
}
