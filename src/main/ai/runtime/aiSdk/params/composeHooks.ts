import { loggerService } from '@logger'

import type { AgentLoopHooks, ErrorContext } from '../loop/types'

const logger = loggerService.withContext('composeHooks')

export function composeHooks(parts: ReadonlyArray<Partial<AgentLoopHooks>>): AgentLoopHooks {
  if (parts.length === 0) return {}
  if (parts.length === 1) return parts[0]

  return {
    onStart: chainVoid(
      parts.map((part) => part.onStart),
      'onStart'
    ),
    onStepFinish: chainVoid(
      parts.map((part) => part.onStepFinish),
      'onStepFinish'
    ),
    onToolExecutionStart: chainVoid(
      parts.map((part) => part.onToolExecutionStart),
      'onToolExecutionStart'
    ),
    onToolExecutionEnd: chainVoid(
      parts.map((part) => part.onToolExecutionEnd),
      'onToolExecutionEnd'
    ),
    onFinish: chainVoid(
      parts.map((part) => part.onFinish),
      'onFinish'
    ),
    onAbort: chainVoid(
      parts.map((part) => part.onAbort),
      'onAbort'
    ),
    onError: chainOnError(parts),
    prepareStep: chainPrepareStep(parts)
  }
}

function chainVoid<TArgs extends unknown[]>(
  hooks: ReadonlyArray<((...args: TArgs) => void | Promise<void>) | undefined>,
  key: string
): ((...args: TArgs) => void | Promise<void>) | undefined {
  const fns = hooks.flatMap((hook) => (hook ? [hook] : []))
  if (fns.length === 0) return undefined
  if (fns.length === 1) return fns[0]
  return async (...args) => {
    for (const fn of fns) {
      try {
        await fn(...args)
      } catch (err) {
        logger.warn(`composed ${key} hook threw; continuing chain`, err as Error)
      }
    }
  }
}

function chainOnError(parts: ReadonlyArray<Partial<AgentLoopHooks>>): AgentLoopHooks['onError'] | undefined {
  const fns = parts.flatMap((p) => {
    const f = p.onError
    return f ? [f] : []
  })
  if (fns.length === 0) return undefined
  if (fns.length === 1) return fns[0]
  return async (ctx: ErrorContext) => {
    let action: 'retry' | 'abort' = 'abort'
    for (const fn of fns) {
      try {
        const r = await fn(ctx)
        if (r === 'retry') action = 'retry'
      } catch (err) {
        // A throwing handler contributes no decision; isolate it and continue
        // the chain so every handler is still invoked (mirrors chainVoid).
        logger.warn('composed onError hook threw; continuing chain', err as Error)
      }
    }
    return action
  }
}

/**
 * Composes multiple `prepareStep` hooks into one.
 *
 * Threading semantics — read carefully: only `messages` is carried forward
 * between chained invocations, so each downstream hook sees the message edits
 * made by the hooks before it. Every other returned key (model, system,
 * toolChoice, …) is NOT threaded into the next hook's `options`; instead all
 * returned keys are shallow-merged last-wins into the single final result. A
 * downstream hook therefore cannot observe an upstream hook's non-`messages`
 * override, but the last writer of any given key still wins in the result the
 * SDK consumes.
 */
function chainPrepareStep(parts: ReadonlyArray<Partial<AgentLoopHooks>>): AgentLoopHooks['prepareStep'] | undefined {
  const fns = parts.flatMap((p) => {
    const f = p.prepareStep
    return f ? [f] : []
  })
  if (fns.length === 0) return undefined
  if (fns.length === 1) return fns[0]
  return async (options) => {
    let mutated = options
    let merged: Record<string, unknown> | undefined
    for (const fn of fns) {
      const r = await fn(mutated)
      if (r) {
        merged ??= {}
        Object.defineProperties(merged, Object.getOwnPropertyDescriptors({ ...r }))
        if (r.messages) {
          mutated = { ...options, messages: r.messages }
        }
      }
    }
    return merged
  }
}
