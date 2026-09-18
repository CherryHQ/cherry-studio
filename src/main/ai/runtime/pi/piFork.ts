import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { readForkPrefix, readNativeForkHistory } from '@main/ai/runtime/fork'

import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../fork'
import { parsePiForkCheckpoint } from './forkCheckpoint'
import { loadPiSdk } from './piSdk'
import { resolveResumeTokenSessionFile } from './piSessionFile'

export async function forkPiSession(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  return readNativeForkHistory(() => preparePiFork(input))
}

async function preparePiFork(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  const checkpoint = parsePiForkCheckpoint(input.checkpoint)
  if (!/^[a-zA-Z0-9-]+$/.test(checkpoint.runtimeSessionId)) throw new AgentSessionForkError('history_corrupt')
  const sessions = application.getPath('feature.agents.pi.sessions')
  const sourceFile = resolveResumeTokenSessionFile(checkpoint.runtimeSessionId, sessions)
  if (!sourceFile) throw new AgentSessionForkError('history_missing')
  const source = await readForkPrefix(sourceFile)
  // The SDK tolerates malformed trailing lines; a fork must not silently omit history.
  for (const line of source.toString('utf8').trimEnd().split('\n')) JSON.parse(line)
  if (!source.equals(await readForkPrefix(sourceFile, source.length)))
    throw new AgentSessionForkError('history_changed')
  const directory = path.join(input.artifactDirectory, 'pi')
  await mkdir(directory, { recursive: false })
  const snapshotFile = path.join(directory, 'source.jsonl')
  await writeFile(snapshotFile, source, { flag: 'wx', mode: 0o600 })
  input.signal.throwIfAborted()
  const sdk = await loadPiSdk()
  const manager = sdk.SessionManager.open(snapshotFile, directory, input.targetCwd)
  if (manager.getSessionId() !== checkpoint.runtimeSessionId || !manager.getEntry(checkpoint.leafId)) {
    throw new AgentSessionForkError('history_changed')
  }
  const file = manager.createBranchedSession(checkpoint.leafId)
  if (!file) throw new AgentSessionForkError('history_corrupt')
  const resumeToken = manager.getSessionId()
  const checkpoints = input.checkpoints.map(parsePiForkCheckpoint).map((value) => {
    if (value.runtimeSessionId !== checkpoint.runtimeSessionId || !manager.getEntry(value.leafId))
      throw new AgentSessionForkError('history_corrupt')
    return parsePiForkCheckpoint({ ...value, runtimeSessionId: resumeToken })
  })
  return { resumeToken, checkpoints, publish: [{ source: file, target: path.join(sessions, path.basename(file)) }] }
}
