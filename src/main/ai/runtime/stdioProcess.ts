import type { ChildProcess } from 'node:child_process'

import type { SpawnStdio, StdioProcess } from '@cherrystudio/agent-runtime/stdio'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'

export const spawnLocalAgentStdio: SpawnStdio = ({ executable, args, cwd, env }) => {
  const child = crossPlatformSpawn(executable, [...args], {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const closed: StdioProcess['closed'] = new Promise((resolve) => {
    child.once('error', (error) => resolve({ kind: 'spawn-failed', error }))
    child.once('close', (code, signal) => resolve({ kind: 'exited', code, signal }))
  })
  const { stdin, stdout, stderr } = child
  if (!stdin || !stdout || !stderr) {
    void stopLocalAgentProcess(child).catch(() => {})
    throw new Error('Local agent stdio is unavailable')
  }
  let closing: Promise<void> | undefined
  return {
    stdin,
    stdout,
    stderr,
    closed,
    closeAndJoin: () =>
      (closing ??= stopLocalAgentProcess(child).catch((error: unknown) => {
        closing = undefined
        throw error
      }))
  }
}

export async function stopLocalAgentProcess(child?: ChildProcess) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    // Headless console processes ignore non-forced taskkill; signal EOF briefly then force-reap the tree.
    try {
      child.stdin?.end()
    } catch {
      /* ignore closed stdio */
    }
    if (await waitForProcessExit(child, 150)) return
    await terminateProcessTree(child, true, 'local agent')
    if (!(await waitForProcessExit(child, 1000))) throw new Error('Local agent process did not exit')
    return
  }
  await terminateProcessTree(child, false, 'local agent')
  if (await waitForProcessExit(child, 1000)) return
  await terminateProcessTree(child, true, 'local agent')
  if (!(await waitForProcessExit(child, 1000))) throw new Error('Local agent process did not exit')
}
