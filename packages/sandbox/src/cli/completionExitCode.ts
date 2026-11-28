import { constants } from 'node:os'

import type { SandboxCompletion } from '../types.js'

export function completionExitCode(
  completion: SandboxCompletion,
  ioFailed: boolean,
  interrupted: NodeJS.Signals | undefined
): number {
  if (ioFailed || completion.tree === 'unknown' || completion.cleanup !== 'complete') return 125
  if (interrupted) return 128 + constants.signals[interrupted]
  if (completion.reason === 'limit' || completion.issues.some((issue) => issue.code === 'LIMIT_EXCEEDED')) return 124
  if (completion.reason !== 'exited' || completion.issues.length) return 125
  return completion.target.exitCode ?? 128 + (constants.signals[completion.target.signal as NodeJS.Signals] ?? 0)
}
