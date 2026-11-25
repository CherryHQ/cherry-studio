import type { OperationResult, RuntimeError } from '@cherrystudio/agent-runtime'

export function failure(operation: string, code: string, cause: unknown): RuntimeError {
  return { operation, code, message: cause instanceof Error ? cause.message : String(cause) }
}

export function unavailable<T>(
  operation: string,
  code: string,
  status: 'rejected' | 'unsupported' | 'unknown' = 'unknown'
): OperationResult<T> {
  return { status, error: failure(operation, code, code) }
}

export async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ACP operation deadline exceeded')), 10_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function untilAborted<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort = () => {}
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
