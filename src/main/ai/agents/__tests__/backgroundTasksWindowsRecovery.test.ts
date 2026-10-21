import type * as NodeChildProcess from 'node:child_process'
import type * as NodeFs from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFileSyncMock, execFileMock } = vi.hoisted(() => ({
  writeFileSyncMock: vi.fn(),
  // `taskkill` failing is its most common outcome: the process has already exited.
  execFileMock: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<{ default: typeof NodeFs }>()).default,
  writeFileSync: writeFileSyncMock
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<{ default: typeof NodeChildProcess }>()).default,
  execFile: execFileMock
}))

import { listDetachedBackgroundTasks, startDetachedBackgroundTask } from '../backgroundTasks'

const nodeBin = `"${process.execPath}"`

// The suite simulates the Windows runner on a POSIX host: a stand-in `powershell.exe` answers the
// identity query, the process table and the job keeper, so the runner can supervise and settle the
// way it does on a real Windows host. A real host cannot run these assertions: its own timing does
// not hold.
const SHIM = `#!/bin/sh
case "$*" in
*-Filter*)
  printf '"ProcessId","CreationDate"\n'
  ;;
*-File*)
  printf 'ready' > "$CHERRY_BG_JOB_READY"
  last=""
  while kill -0 "$CHERRY_BG_JOB_RUNNER" 2>/dev/null; do
    if [ -f "$CHERRY_BG_JOB_REQUEST" ]; then
      nonce=$(cat "$CHERRY_BG_JOB_REQUEST" 2>/dev/null)
      if [ -n "$nonce" ] && [ "$nonce" != "$last" ]; then
        last="$nonce"
        printf '{"nonce":"%s","pids":[]}' "$nonce" > "$CHERRY_BG_JOB_FILE.staging" &&
          mv "$CHERRY_BG_JOB_FILE.staging" "$CHERRY_BG_JOB_FILE" 2>/dev/null
      fi
    fi
    sleep 0.05
  done
  ;;
*)
  printf '"ProcessId","ParentProcessId","CreationDate"\n'
  ;;
esac
exit 0`

describe.skipIf(process.platform === 'win32')('a Windows task whose record write fails', () => {
  let storageDir: string
  let shimDir: string
  let realPath: string | undefined
  let realPlatform: NodeJS.Platform

  beforeEach(async () => {
    // The awaited `taskkill` is the only yield between the failed record write and the recovery
    // write, so only the Windows branch can have the child finish inside it.
    realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    storageDir = await mkdtemp(path.join(tmpdir(), 'cherry-untracked-win-'))
    shimDir = await mkdtemp(path.join(tmpdir(), 'cherry-untracked-shim-'))
    await writeFile(path.join(shimDir, 'powershell.exe'), SHIM)
    await chmod(path.join(shimDir, 'powershell.exe'), 0o755)
    realPath = process.env.PATH
    process.env.PATH = `${shimDir}${path.delimiter}${process.env.PATH}`
    const real = (await vi.importActual<typeof NodeFs>('node:fs')).writeFileSync
    let writes = 0
    writeFileSyncMock.mockImplementation((...args: unknown[]) => {
      writes += 1
      if (writes === 1) throw new Error('ENOSPC: no space left on device')
      return (real as unknown as (...a: unknown[]) => void)(...args)
    })
    // `taskkill` is a real process spawn, so it outlives a task that finishes quickly and then
    // reports the process it was asked to kill is already gone. The delay is what opens the window
    // wide enough for the supervised runner to observe the exit and settle inside it.
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void
      setTimeout(() => callback(new Error('ERROR: The process could not be terminated.')), 4_000)
    })
  })

  afterEach(async () => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    if (realPath !== undefined) process.env.PATH = realPath
    writeFileSyncMock.mockReset()
    execFileMock.mockReset()
    await rm(shimDir, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  })

  it('does not tell the agent a task is still running when the same call published its completion', async () => {
    // The start reports failure to the agent, so its message is the signal that keeps the agent
    // from retrying a command that is still in flight. When this same call has already announced
    // the task finished, that message contradicts the notification and invites a poll for a task
    // that is done.
    const onExit = vi.fn()
    const failure = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => {}, 50)"`,
      cwd: storageDir,
      onExit
    }).then(
      () => {
        throw new Error('expected the start to fail')
      },
      (error: Error) => error
    )

    const deadline = Date.now() + 10_000
    let [record] = await listDetachedBackgroundTasks(storageDir)
    while (record.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      ;[record] = await listDetachedBackgroundTasks(storageDir)
    }

    expect(record.status).toBe('completed')
    // `finalize` writes the completed record, then the sentinel, and only then notifies — the
    // poll above can observe the record between those writes, so the notification needs its own wait.
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
    expect(failure.message).toContain('already finished')
    expect(failure.message).not.toMatch(/is still running/)
  })

  it('does not call a task still running when the recovery record fails too', async () => {
    // A failing write is what brings this recovery into being, and one failing write rarely means
    // the next succeeds — a full disk or a vanished directory takes both. That strands the
    // completion the close listener had already captured, so the message must still name the task
    // as finished: telling the agent it is running sends it to poll a process that has exited, and
    // one that left no record to poll.
    writeFileSyncMock.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device')
    })

    const failure = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => {}, 50)"`,
      cwd: storageDir
    }).then(
      () => {
        throw new Error('expected the start to fail')
      },
      (error: Error) => error
    )
    // The taskkill window is 4s and the task exits at 50ms, so this only waits out the spawn.
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(await listDetachedBackgroundTasks(storageDir)).toEqual([])
    expect(failure.message).toContain('already finished')
    expect(failure.message).not.toMatch(/is still running/)
  })
})
