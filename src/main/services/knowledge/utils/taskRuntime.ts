export const SHUTDOWN_INTERRUPTED_REASON = 'Knowledge task interrupted by service shutdown'

export interface RuntimeTaskContext {
  itemId: string
  signal: AbortSignal
}

export async function runAbortable<T>(
  isStopping: boolean,
  ctx: RuntimeTaskContext,
  step: () => Promise<T> | T
): Promise<T> {
  assertTaskActive(isStopping, ctx)
  const result = await step()
  assertTaskActive(isStopping, ctx)
  return result
}

export function assertTaskActive(isStopping: boolean, ctx: RuntimeTaskContext): void {
  if (isStopping || ctx.signal.aborted) {
    throw new Error(SHUTDOWN_INTERRUPTED_REASON)
  }
}
