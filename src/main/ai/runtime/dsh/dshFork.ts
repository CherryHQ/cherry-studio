import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as z from 'zod'

import { application } from '@application'
import { resolveBundledDshRuntimeEntry } from '@cherrystudio/dsh-bridge'

import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../fork'
import { runForkWorker } from '../fork'
import { parseDshForkCheckpoint } from './forkCheckpoint'
import type { DshForkWorkerInput } from './forkWorker'

export async function forkDshSession(input: RuntimeForkInput, snapshotEvents?: unknown[]): Promise<RuntimeForkResult> {
  const checkpoint = parseDshForkCheckpoint(input.checkpoint)
  const sourceRoot = application.getPath('feature.agents.dsh.sessions')
  const targetRoot = path.join(input.artifactDirectory, 'dsh')
  const checkpoints = input.checkpoints.map(parseDshForkCheckpoint).map((value) => {
    if (value.boundary > checkpoint.boundary || value.runtimeSessionId !== checkpoint.runtimeSessionId)
      throw new AgentSessionForkError('history_changed')
    return value
  })
  const { default: createWorker } = await import('./forkWorker?nodeWorker')
  input.signal.throwIfAborted()
  const workerData: DshForkWorkerInput = {
    modulePath: pathToFileURL(resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/fork')).href,
    sourceRoot,
    targetRoot,
    sourceSessionId: checkpoint.runtimeSessionId,
    targetSessionId: input.targetSessionId,
    targetCwd: input.targetCwd,
    boundary: checkpoint.boundary,
    checkpoints: checkpoints.map(({ boundary }) => ({ boundary })),
    events: snapshotEvents
  }
  const worker = createWorker({ workerData, env: { ...process.env } })
  const parsed = z.strictObject({ path: z.string().min(1) }).safeParse(await runForkWorker(worker, input.signal))
  if (!parsed.success) throw new AgentSessionForkError('history_corrupt')
  const result = parsed.data
  const relative = path.relative(targetRoot, result.path)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid DSH artifact path')
  return {
    resumeToken: input.targetSessionId,
    checkpoints: checkpoints.map((value) =>
      parseDshForkCheckpoint({ ...value, runtimeSessionId: input.targetSessionId })
    ),
    publish: [{ source: result.path, target: path.join(sourceRoot, relative) }]
  }
}
