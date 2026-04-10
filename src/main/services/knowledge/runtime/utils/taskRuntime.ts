export const SHUTDOWN_INTERRUPTED_REASON = 'Knowledge task interrupted by service shutdown'
export const DELETE_INTERRUPTED_REASON = 'Knowledge task interrupted by item deletion'

export interface RuntimeTaskContext {
  itemId: string
  signal: AbortSignal
}

/**
 * Runs one async runtime step with interruption checks before and after the
 * step body.
 */
export async function runAbortable<T>(
  isStopping: () => boolean,
  ctx: RuntimeTaskContext,
  step: () => Promise<T> | T
): Promise<T> {
  assertTaskActive(isStopping, ctx)
  const result = await step()
  assertTaskActive(isStopping, ctx)
  return result
}

/**
 * Throws when the runtime has been interrupted by shutdown or abort signal.
 */
export function assertTaskActive(isStopping: () => boolean, ctx: RuntimeTaskContext): void {
  if (ctx.signal.aborted) {
    const reason =
      typeof ctx.signal.reason === 'string' && ctx.signal.reason.length > 0
        ? ctx.signal.reason
        : SHUTDOWN_INTERRUPTED_REASON
    throw new Error(reason)
  }

  if (isStopping()) {
    throw new Error(SHUTDOWN_INTERRUPTED_REASON)
  }
}
