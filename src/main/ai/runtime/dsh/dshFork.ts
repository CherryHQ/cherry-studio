import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { resolveBundledDshRuntimeEntry } from '@cherrystudio/dsh-bridge'

import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../forkCheckpoint'
import { runForkWorker } from '../runForkWorker'

export function readDshForkContext(events: unknown[], boundary: number) {
  return runForkWorker<{ identity: string; messages: unknown[] } | undefined>(
    {
      runtime: 'dsh-context',
      modulePath: pathToFileURL(resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/fork')).href,
      events,
      boundary
    },
    AbortSignal.timeout(10_000)
  )
}

export async function forkDshSession(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  const checkpoint = input.checkpoint
  if (checkpoint.runtime !== 'dsh') throw new AgentSessionForkError('unsupported_checkpoint')
  const sourceRoot = application.getPath('feature.agents.dsh.sessions')
  const targetRoot = path.join(input.artifactDirectory, 'dsh')
  const result = await runForkWorker<{ path: string }>(
    {
      runtime: 'dsh',
      modulePath: pathToFileURL(resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/fork')).href,
      sourceRoot,
      targetRoot,
      sourceSessionId: checkpoint.runtimeSessionId,
      targetSessionId: input.targetSessionId,
      targetCwd: input.targetCwd,
      boundary: checkpoint.boundary,
      events: input.snapshotEvents
    },
    input.signal
  )
  const relative = path.relative(targetRoot, result.path)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid DSH artifact path')
  return {
    resumeToken: input.targetSessionId,
    checkpoints: input.checkpoints.map((value) => {
      if (
        value.runtime !== 'dsh' ||
        value.boundary > checkpoint.boundary ||
        value.runtimeSessionId !== checkpoint.runtimeSessionId
      )
        throw new AgentSessionForkError('history_changed')
      return { ...value, runtimeSessionId: input.targetSessionId }
    }),
    publish: [{ source: result.path, target: path.join(sourceRoot, relative) }]
  }
}
