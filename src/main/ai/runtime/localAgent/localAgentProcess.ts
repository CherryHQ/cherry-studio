import type { ChildProcess } from 'node:child_process'

import { terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'

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
