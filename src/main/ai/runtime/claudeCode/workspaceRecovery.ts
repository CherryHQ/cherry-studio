import * as z from 'zod'

import { runForkWorker } from '../fork'
import type { ClaudeRecoveryWorkerInput } from './workspaceRecoveryWorker'

/** Native lookup and copy-only recovery run off the main thread, with the worker's own config env. */
export async function recoverClaudeWorkspaceHistory(input: ClaudeRecoveryWorkerInput): Promise<void> {
  const { default: createWorker } = await import('./workspaceRecoveryWorker?nodeWorker')
  const worker = createWorker({ workerData: input, env: { ...process.env, CLAUDE_CONFIG_DIR: input.configDir } })
  const result = await runForkWorker(worker, AbortSignal.timeout(15_000))
  z.strictObject({ verified: z.literal(true) }).parse(result)
}
