import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'

import { readForkPrefix, readNativeForkHistory } from '../../agentSession/forkFiles'
import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../forkCheckpoint'
import { loadPiSdk } from './piSdk'

export async function forkPiSession(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  return readNativeForkHistory(() => preparePiFork(input))
}

async function preparePiFork(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  const checkpoint = input.checkpoint
  if (checkpoint.runtime !== 'pi') throw new AgentSessionForkError('unsupported_checkpoint')
  if (!/^[a-zA-Z0-9-]+$/.test(checkpoint.runtimeSessionId)) throw new AgentSessionForkError('history_corrupt')
  const sessions = application.getPath('feature.agents.pi.sessions')
  const candidates = (await readdir(sessions)).filter((name) =>
    name.endsWith('_' + checkpoint.runtimeSessionId + '.jsonl')
  )
  if (candidates.length !== 1)
    throw new AgentSessionForkError(candidates.length ? 'history_corrupt' : 'history_missing')
  const sourceFile = path.join(sessions, candidates[0])
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
  const checkpoints = input.checkpoints.map((value) => {
    if (
      value.runtime !== 'pi' ||
      value.runtimeSessionId !== checkpoint.runtimeSessionId ||
      !manager.getEntry(value.leafId)
    )
      throw new AgentSessionForkError('history_corrupt')
    return { ...value, runtimeSessionId: resumeToken }
  })
  return { resumeToken, checkpoints, publish: [{ source: file, target: path.join(sessions, path.basename(file)) }] }
}
