/**
 * Static reminder injection — every-turn injection of `<system-reminder>`
 * blocks (project-instructions / AGENTS.md, etc.) into the latest user
 * message at the LMv3 middleware layer.
 *
 * Why a plugin / `transformParams`: AiService should not know about
 * reminders. The LMv3 boundary is where any per-call message mutation
 * should happen (mirrors `anthropic-cache` adding `cacheControl` to
 * messages, `pdf-compatibility` reshaping file parts, etc.).
 *
 * The middleware caches `collectStaticReminders` per-request via a
 * closure promise — the agent loop calls `transformParams` once per
 * step, and we don't want to re-stat AGENTS.md on every step. The
 * actual file read inside `agentsMdSource` is also CacheService-cached
 * by mtime, so even cross-request the cost is a stat() per call.
 *
 * `wrapInXmlTag` is idempotent on its own — same-content wrap returns
 * unchanged — so even if a future bug causes double-injection, the
 * model wouldn't see duplicated blocks.
 */

import type { LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import type { LanguageModelMiddleware } from 'ai'

import { wrapInXmlTag } from '../../../messages/syntheticUserMessage'
import { collectStaticReminders } from '../../../reminders/collectStatic'
import type { ReminderBlock } from '../../../reminders/types'
import type { RequestFeature } from '../feature'

const REMINDER_TAG = 'system-reminder'
const SEPARATOR = '\n\n'

function staticRemindersMiddleware(workspaceRoot: string | null): LanguageModelMiddleware {
  let blocksPromise: Promise<ReminderBlock[]> | null = null

  return {
    specificationVersion: 'v3' as const,
    transformParams: async ({ params }) => {
      blocksPromise ??= collectStaticReminders({ workspaceRoot })
      const blocks = await blocksPromise
      if (blocks.length === 0) return params
      if (!Array.isArray(params.prompt) || params.prompt.length === 0) return params

      const messages = params.prompt as LanguageModelV3Message[]
      let targetIdx = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          targetIdx = i
          break
        }
      }
      if (targetIdx === -1) return params

      const wrapped = blocks.map((b) => wrapInXmlTag(REMINDER_TAG, { name: b.name }, b.content)).join(SEPARATOR)

      const target = messages[targetIdx]
      if (target.role !== 'user') return params

      const firstTextIdx = target.content.findIndex((p) => p.type === 'text')
      let nextContent: typeof target.content
      if (firstTextIdx === -1) {
        nextContent = [{ type: 'text', text: wrapped }, ...target.content]
      } else {
        const original = target.content[firstTextIdx]
        if (original.type !== 'text') return params
        const updated = { ...original, text: `${wrapped}${SEPARATOR}${original.text}` }
        nextContent = target.content.map((p, i) => (i === firstTextIdx ? updated : p))
      }

      const nextMessages = messages.slice()
      nextMessages[targetIdx] = { ...target, content: nextContent }
      return { ...params, prompt: nextMessages }
    }
  }
}

function createStaticRemindersPlugin(workspaceRoot: string | null) {
  return definePlugin({
    name: 'static-reminders',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(staticRemindersMiddleware(workspaceRoot))
    }
  })
}

/**
 * Always-on for now. The plugin no-ops cheaply when there's no
 * workspace, no AGENTS.md, and no other static reminder source — so
 * gating with `applies` adds no measurable value over the in-plugin
 * fast path.
 */
export const staticRemindersFeature: RequestFeature = {
  name: 'static-reminders',
  contributeModelAdapters: (scope) => [createStaticRemindersPlugin(scope.workspaceRoot)]
}
