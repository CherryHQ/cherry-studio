import { loggerService } from '@logger'

import type { AgentLoopHooks, ErrorContext } from '../loop'

const logger = loggerService.withContext('composeHooks')

export function composeHooks(parts: ReadonlyArray<Partial<AgentLoopHooks>>): AgentLoopHooks {
  if (parts.length === 0) return {}
  if (parts.length === 1) return parts[0]

  return {
    onStart: chainVoid(parts, 'onStart'),
    onStepFinish: chainVoid(parts, 'onStepFinish'),
    onToolExecutionStart: chainVoid(parts, 'onToolExecutionStart'),
    onToolExecutionEnd: chainVoid(parts, 'onToolExecutionEnd'),
    onFinish: chainVoid(parts, 'onFinish'),
    onError: chainOnError(parts),
    prepareStep: chainPrepareStep(parts)
  }
}

type VoidHookKey = 'onStart' | 'onStepFinish' | 'onToolExecutionStart' | 'onToolExecutionEnd' | 'onFinish'

function chainVoid<K extends VoidHookKey>(
  parts: ReadonlyArray<Partial<AgentLoopHooks>>,
  key: K
): AgentLoopHooks[K] | undefined {
  type Fn = NonNullable<AgentLoopHooks[K]>
  const fns = parts.map((p) => p[key]).filter((f): f is Fn => Boolean(f))
  if (fns.length === 0) return undefined
  if (fns.length === 1) return fns[0]
  const composed = async (...args: Parameters<Fn>): Promise<void> => {
    for (const fn of fns) {
      try {
        await (fn as (...a: Parameters<Fn>) => unknown)(...args)
      } catch (err) {
        logger.warn(`composed ${key} hook threw; continuing chain`, err as Error)
      }
    }
  }
  return composed as AgentLoopHooks[K]
}

function chainOnError(parts: ReadonlyArray<Partial<AgentLoopHooks>>): AgentLoopHooks['onError'] | undefined {
  const fns = parts.map((p) => p.onError).filter((f): f is NonNullable<AgentLoopHooks['onError']> => Boolean(f))
  if (fns.length === 0) return undefined
  if (fns.length === 1) return fns[0]
  return async (ctx: ErrorContext) => {
    let action: 'retry' | 'abort' = 'abort'
    for (const fn of fns) {
      const r = await fn(ctx)
      if (r === 'retry') action = 'retry'
    }
    return action
  }
}

function chainPrepareStep(parts: ReadonlyArray<Partial<AgentLoopHooks>>): AgentLoopHooks['prepareStep'] | undefined {
  const fns = parts.map((p) => p.prepareStep).filter((f): f is NonNullable<AgentLoopHooks['prepareStep']> => Boolean(f))
  if (fns.length === 0) return undefined
  if (fns.length === 1) return fns[0]
  return async (options) => {
    let mutated = options
    let merged: Record<string, unknown> | undefined
    for (const fn of fns) {
      const r = await fn(mutated)
      if (r) {
        merged = { ...merged, ...r }
        if (r.messages) {
          mutated = { ...mutated, messages: r.messages }
        }
      }
    }
    return merged as Awaited<ReturnType<NonNullable<AgentLoopHooks['prepareStep']>>>
  }
}
