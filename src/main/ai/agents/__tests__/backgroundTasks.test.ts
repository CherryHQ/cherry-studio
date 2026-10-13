import type * as ChildProcessModule from 'node:child_process'
import type { ExecFileSyncOptions } from 'node:child_process'
import { spawn } from 'node:child_process'
import type * as FsPromisesModule from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The process table is the only identity evidence a stop can consult, so the identity tests steer
// its `ps` readings directly: returning `null` delegates to the real table, and every spawn and
// signal around it stays real. This is what lets a table like the one a recycled pgid leaves
// behind — live members this app never started — be reproduced without waiting on pid reuse.
const { psSteer } = vi.hoisted(() => ({
  psSteer: { read: null as null | ((args: readonly string[]) => string | null) }
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return {
    ...actual,
    execFileSync: ((file: string, args?: readonly string[], options?: ExecFileSyncOptions) => {
      const steer = psSteer.read
      const steered = file === 'ps' && steer ? steer(args ?? []) : null
      if (steered !== null) return steered
      return actual.execFileSync(file, args ?? [], options)
    }) as typeof actual.execFileSync
  }
})

// The record write is the seam that opens the window being closed: it is the only await between
// the identity check and the group signal, so it is where a modifying process identity gets handed
// to another owner. `null` delegates to the real filesystem.
const { writeHook } = vi.hoisted(() => ({
  writeHook: { onWrite: null as null | ((target: string) => Promise<void> | void) }
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromisesModule>()
  return {
    ...actual,
    writeFile: (async (target: Parameters<typeof actual.writeFile>[0], ...rest: unknown[]) => {
      await writeHook.onWrite?.(String(target))
      // @ts-expect-error passthrough of the variadic overload set
      return actual.writeFile(target, ...rest)
    }) as typeof actual.writeFile
  }
})

import {
  BACKGROUND_TASK_RECORD_EXT,
  BACKGROUND_TASK_SENTINEL_EXT,
  MAX_BACKGROUND_TASK_COMMAND_LENGTH,
  type BackgroundTaskRecord,
  POSIX_DETACHED_TASK_SUPERVISOR,
  WINDOWS_DETACHED_TASK_RUNNER,
  buildDetachedBackgroundTaskSpawn,
  getDetachedBackgroundTask,
  isPidAlive,
  listDetachedBackgroundTasks,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask
} from '../backgroundTasks'

// Double quotes survive both POSIX sh and cmd.exe, including spaced paths.
const nodeBin = `"${process.execPath}"`
// Exercise the shell's own output so this test isolates the detached task log redirection.
const okCommand = 'echo bg-ok'
// Lives long enough that the persisted record is still "running" when read back on fast runners.
const slowOkCommand = `${nodeBin} -e "console.log('bg-ok'); setTimeout(() => process.exit(0), 750)"`
const failCommand = `${nodeBin} -e "process.exit(3)"`

describe('backgroundTasks', () => {
  let storageDir: string

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-tasks-'))
  })

  // The 15s retry loop below outlives vitest's default 10s hookTimeout, so the hook must
  // carry its own budget or the runner kills it mid-retry with an anonymous timeout error.
  afterEach(async () => {
    // A force-killed detached child releases its log fd and cwd handle a beat after taskkill
    // returns — the kernel reaps them asynchronously, and a loaded Windows runner was observed
    // holding the directory well past fifteen seconds too. No fixed window covers every load,
    // and a temp dir the runner's own scanners still hold is not the tests' business to fight:
    // past the deadline the directory is left to the disposable machine instead of failing here.
    const deadline = Date.now() + 15_000
    for (;;) {
      try {
        await rm(storageDir, { recursive: true, force: true })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const retryable = code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EPERM'
        if (!retryable) throw error
        if (Date.now() >= deadline) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }, 20_000)

  describe('buildDetachedBackgroundTaskSpawn', () => {
    it('detaches the child into its own session with the log fds wired to stdio', () => {
      const { options } = buildDetachedBackgroundTaskSpawn('echo hi', '/workspace', 7, 7)
      expect(options.detached).toBe(true)
      expect(options.windowsHide).toBe(true)
      expect(options.cwd).toBe('/workspace')
      // stdin closed, stdout and stderr both point at the task log fd.
      expect(options.stdio).toEqual(['ignore', 7, 7])
    })

    it.skipIf(process.platform !== 'win32')('routes the command through the detached Node runner', () => {
      // A detached cmd.exe drops the log fds, so the shell itself must stay attached.
      const { file, args, options } = buildDetachedBackgroundTaskSpawn('echo hi', '/workspace', 7, 7)
      expect(file).toBe(process.execPath)
      expect(args).toEqual(['-e', WINDOWS_DETACHED_TASK_RUNNER, 'echo hi'])
      expect(options.shell).toBeUndefined()
      expect(options.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    })

    it.skipIf(process.platform === 'win32')('runs the command under the group supervisor on POSIX', () => {
      const { file, args, options } = buildDetachedBackgroundTaskSpawn('echo hi', '/workspace', 7, 7)
      // The supervisor leads the group, so the recorded pid is its own and the group it leads is
      // the task's for as long as it lives. It must ignore the stop signals: they are addressed to
      // the work, and an anchor that abandoned the group would strand the members it vouches for.
      expect(file).toBe(process.execPath)
      expect(args[0]).toBe('-e')
      expect(args[1]).toBe(POSIX_DETACHED_TASK_SUPERVISOR)
      expect(args[2]).toBe('echo hi')
      expect(options.shell).toBeUndefined()
      // `process.execPath` is the Electron binary in the packaged app, so the supervisor only
      // reaches Node mode when the app hands it this flag.
      expect(options.env?.ELECTRON_RUN_AS_NODE).toBe('1')
      // The stop signals are the work's, not the anchor's: a supervisor that died on SIGTERM
      // would strand the members it exists to vouch for.
      expect(POSIX_DETACHED_TASK_SUPERVISOR).toContain("'SIGTERM'")
      expect(POSIX_DETACHED_TASK_SUPERVISOR).toContain('process.on(ignored, () => {})')
      // No unref on the drain poll: an unref'd timer would let the anchor exit before its first
      // tick, while the group still holds live members.
      expect(POSIX_DETACHED_TASK_SUPERVISOR).not.toContain('poll.unref')
    })
  })

  describe('startDetachedBackgroundTask', () => {
    it.skipIf(process.platform === 'win32')('stops a detached process group and keeps a stopped record', async () => {
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
        cwd: storageDir
      })
      const stopped = await stopDetachedBackgroundTask(storageDir, record.id)
      expect(['running', 'stopped']).toContain(stopped?.status)
      expect(stopped?.stopSignal).toBe('SIGTERM')
      await vi.waitFor(async () => {
        expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('stopped')
      })
      expect(await stopDetachedBackgroundTask(storageDir, record.id)).toBeUndefined()
    })
    it('registers a running record and reports completion with sentinel and log', async () => {
      const onExit = vi.fn()
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: slowOkCommand,
        cwd: storageDir,
        name: 'echo job',
        onExit
      })

      expect(record.status).toBe('running')
      expect(record.pid).toBeGreaterThan(0)
      expect(record.name).toBe('echo job')
      expect(record.logFile).toBe(path.join(storageDir, `${record.id}.log`))
      expect(await readFile(path.join(storageDir, `${record.id}.json`), 'utf8')).toContain('"running"')

      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
      const completion = onExit.mock.calls[0][0]
      expect(completion.record.status).toBe('completed')
      expect(completion.record.exitCode).toBe(0)
      expect(completion.summary).toContain('finished with exit code 0')
      expect(completion.summary).toContain(record.logFile)

      const sentinel = JSON.parse(
        await readFile(path.join(storageDir, `${record.id}${BACKGROUND_TASK_SENTINEL_EXT}`), 'utf8')
      )
      expect(sentinel.status).toBe('completed')
      expect(sentinel.exitCode).toBe(0)

      const log = await readFile(record.logFile, 'utf8')
      expect(log).toContain('bg-ok')
    })

    it('marks a non-zero exit as failed with the exit code', async () => {
      const onExit = vi.fn()
      const record = await startDetachedBackgroundTask({ storageDir, command: failCommand, cwd: storageDir, onExit })

      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
      expect(onExit.mock.calls[0][0].record.status).toBe('failed')
      expect(onExit.mock.calls[0][0].record.exitCode).toBe(3)
      expect(record.status).toBe('running') // the returned record is the start snapshot
    })

    it('reports a spawn failure through the error event instead of throwing', async () => {
      const onExit = vi.fn()
      // shell:true makes an unknown binary exit 127 inside the shell; a missing
      // cwd is what fails the spawn itself and fires the child 'error' event.
      await startDetachedBackgroundTask({
        storageDir,
        command: okCommand,
        cwd: path.join(storageDir, 'does-not-exist'),
        onExit
      })

      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
      expect(onExit.mock.calls[0][0].record.status).toBe('failed')
    })

    it('rejects an empty or oversized command', async () => {
      await expect(startDetachedBackgroundTask({ storageDir, command: '   ', cwd: storageDir })).rejects.toThrow(
        /empty/i
      )
      await expect(
        startDetachedBackgroundTask({
          storageDir,
          command: 'x'.repeat(MAX_BACKGROUND_TASK_COMMAND_LENGTH + 1),
          cwd: storageDir
        })
      ).rejects.toThrow(/exceeds/)
    })

    it.skipIf(process.platform === 'win32')(
      'runs the command as Node in Electron and does not leak the Node flag into it',
      async () => {
        // The packaged app launches the supervisor with ELECTRON_RUN_AS_NODE=1 so `process.execPath`
        // — the Electron binary — behaves as Node. That flag names the supervisor's own process: left
        // in the environment it would turn every Electron binary the command itself launches into a
        // plain Node, so the supervisor has to strip it before starting the work.
        const onExit = vi.fn()
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "process.stdout.write(String(process.env.ELECTRON_RUN_AS_NODE))"`,
          cwd: storageDir,
          onExit
        })

        await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
        const log = await readFile(record.logFile, 'utf8')
        expect(log.trim()).toBe('undefined')
      }
    )
  })

  describe('list / status reconciliation', () => {
    it('returns completed tasks as-is and running tasks still alive as running', async () => {
      const onExit = vi.fn()
      const finished = await startDetachedBackgroundTask({ storageDir, command: okCommand, cwd: storageDir, onExit })
      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })

      const running = await startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setTimeout(() => {}, 30_000)"`,
        cwd: storageDir
      })

      try {
        const tasks = await listDetachedBackgroundTasks(storageDir)
        const byId = new Map(tasks.map((task) => [task.id, task]))
        expect(byId.get(finished.id)?.status).toBe('completed')
        expect(byId.get(running.id)?.status).toBe('running')

        const status = await getDetachedBackgroundTask(storageDir, running.id)
        expect(status?.status).toBe('running')
        expect(status?.pid).toBe(running.pid)
      } finally {
        await stopDetachedBackgroundTask(storageDir, running.id, true)
        // Wait out the kill so the child cannot hold handles into storageDir.
        await vi.waitFor(() => expect(isPidAlive(running.pid)).toBe(false), { timeout: 10_000 })
      }
    })

    it('notifies the completion channels when a task is force-killed', async () => {
      // A kill ends the task without the child ever exiting, so no exit event fires and nothing
      // else would tell the configured channels the task the user stopped has stopped.
      const onExit = vi.fn()
      const running = await startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
        cwd: storageDir
      })

      try {
        await stopDetachedBackgroundTask(storageDir, running.id, true, onExit)

        expect(onExit).toHaveBeenCalledTimes(1)
        expect(onExit.mock.calls[0][0].record.status).toBe('stopped')
        expect(onExit.mock.calls[0][0].summary).toContain(running.id)
      } finally {
        await vi.waitFor(() => expect(isPidAlive(running.pid)).toBe(false), { timeout: 10_000 })
      }
    })

    it.skipIf(process.platform === 'win32')('does not show a recycled pid as a running task', async () => {
      // Simulate the app restarting and the OS handing the task's old pid to something else: the
      // pid is alive, but the recorded start stamp is the only proof it is no longer this task.
      const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], { stdio: 'ignore' })
      try {
        expect(isPidAlive(unrelated.pid!)).toBe(true)
        await writeFile(
          path.join(storageDir, 'bt-recycled.json'),
          JSON.stringify({
            id: 'bt-recycled',
            name: 'recycled',
            command: okCommand,
            pid: unrelated.pid,
            pidStartTime: 'Mon Jan  1 00:00:00 2001',
            cwd: storageDir,
            startedAt: new Date().toISOString(),
            logFile: path.join(storageDir, 'bt-recycled.log'),
            status: 'running',
            exitCode: null,
            signal: null
          })
        )

        const reconciled = await getDetachedBackgroundTask(storageDir, 'bt-recycled')
        expect(reconciled?.status).toBe('unknown')
        // Uncontrollable and unidentifiable: the stop path must still refuse to signal it.
        await expect(stopDetachedBackgroundTask(storageDir, 'bt-recycled', true)).resolves.toBeUndefined()
        expect(isPidAlive(unrelated.pid!)).toBe(true)
      } finally {
        unrelated.kill('SIGKILL')
      }
    })

    it('flags a dead pid without a sentinel as unknown', async () => {
      const onExit = vi.fn()
      const finished = await startDetachedBackgroundTask({ storageDir, command: failCommand, cwd: storageDir, onExit })
      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })

      // Simulate an app restart that lost the in-process exit handler: the
      // record still says "running", the process is gone, no sentinel exists.
      const recordPath = path.join(storageDir, `${finished.id}.json`)
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as BackgroundTaskRecord
      record.status = 'running'
      await writeFile(recordPath, JSON.stringify(record))
      await rm(path.join(storageDir, `${finished.id}${BACKGROUND_TASK_SENTINEL_EXT}`))

      const reconciled = await getDetachedBackgroundTask(storageDir, finished.id)
      expect(reconciled?.status).toBe('unknown')
      expect(reconciled?.note).toContain('completion marker')
    })

    it('adopts the sentinel when the record was left running', async () => {
      const onExit = vi.fn()
      const finished = await startDetachedBackgroundTask({ storageDir, command: okCommand, cwd: storageDir, onExit })
      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })

      const recordPath = path.join(storageDir, `${finished.id}.json`)
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as BackgroundTaskRecord
      record.status = 'running'
      await writeFile(recordPath, JSON.stringify(record))

      const reconciled = await getDetachedBackgroundTask(storageDir, finished.id)
      expect(reconciled?.status).toBe('completed')
    })

    it('returns empty for a missing directory and undefined for a missing task id', async () => {
      await expect(listDetachedBackgroundTasks(path.join(storageDir, 'nope'))).resolves.toEqual([])
      await expect(getDetachedBackgroundTask(storageDir, 'bt-missing')).resolves.toBeUndefined()
      await expect(getDetachedBackgroundTask(storageDir, '../escape')).resolves.toBeUndefined()
    })
  })

  describe('leaderless group controllability', () => {
    // A worker that outlives its shell: it installs a SIGTERM handler, prints its pid, and
    // keeps running inside the detached group after the shell exits.
    const orphanWorkerCommand = `${nodeBin} -e "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid)); setInterval(() => {}, 60_000)" &`
    // A real group member that exits before its leader, so the group is empty at the leader's close.
    const memberDiesFirstCommand = `${nodeBin} -e "require('child_process').spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 300)'])"`

    /**
     * Waits for the command's shell to exit — the supervisor outlives it by design — and returns
     * the surviving worker's pid.
     */
    async function waitForOrphanedWorker(record: BackgroundTaskRecord): Promise<number> {
      await vi.waitFor(
        async () => {
          expect((await readFile(record.logFile, 'utf8')).trim()).toMatch(/^\d+$/)
        },
        { timeout: 10_000 }
      )
      const workerPid = Number((await readFile(record.logFile, 'utf8')).trim())
      expect(isPidAlive(workerPid)).toBe(true)
      return workerPid
    }

    it.skipIf(process.platform === 'win32')(
      'keeps a task controllable while its group holds a live member after the shell exits',
      async () => {
        const record = await startDetachedBackgroundTask({ storageDir, command: orphanWorkerCommand, cwd: storageDir })
        const workerPid = await waitForOrphanedWorker(record)

        try {
          // The shell is gone but the work is not: the record must not read as terminal,
          // or every control path (kill, UI, purge) would turn its back on the survivor.
          const task = await getDetachedBackgroundTask(storageDir, record.id)
          expect(task?.status).toBe('running')

          // A plain stop reaches the group; the member ignoring SIGTERM keeps the task running.
          const afterStop = await stopDetachedBackgroundTask(storageDir, record.id)
          expect(afterStop?.status).toBe('running')
          expect(isPidAlive(workerPid)).toBe(true)

          // Kill stays reachable and closes the task only once the survivor is gone.
          const stopped = await stopDetachedBackgroundTask(storageDir, record.id, true)
          expect(stopped?.status).toBe('stopped')
          await vi.waitFor(() => expect(isPidAlive(workerPid)).toBe(false), { timeout: 10_000 })
          expect(await stopDetachedBackgroundTask(storageDir, record.id, true)).toBeUndefined()
        } finally {
          try {
            process.kill(-record.pid, 'SIGKILL')
          } catch {
            // the group is already gone
          }
        }
      }
    )

    it.skipIf(process.platform === 'win32')(
      'finalizes a task whose group empties together with its shell',
      async () => {
        const onExit = vi.fn()
        await startDetachedBackgroundTask({ storageDir, command: memberDiesFirstCommand, cwd: storageDir, onExit })

        await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
        const completion = onExit.mock.calls[0][0]
        expect(completion.record.status).toBe('completed')
        expect(completion.record.exitCode).toBe(0)
      }
    )

    it.skipIf(process.platform === 'win32')(
      'finalizes with the shell completion once its backgrounded worker drains',
      async () => {
        // `... &`: the shell closes while its worker holds the group open (the log is a
        // file, so nothing holds the close back), and that one close handler is the only exit
        // observation. It must survive and land — with the shell's own exit code, not an
        // invented descendant one — once the worker exits.
        const onExit = vi.fn()
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "process.stdout.write(String(process.pid)); setTimeout(() => process.exit(7), 900)" &`,
          cwd: storageDir,
          onExit
        })
        try {
          // The backgrounded worker publishes its own pid at its own pace, and a loaded runner can
          // hold that write well past the shell's exit — an unsynchronized read of the empty log
          // would parse pid 0 and then wait on it until the deadline. The wait is on the
          // publication itself (waitForOrphanedWorker), never on elapsed time.
          const workerPid = await waitForOrphanedWorker(record)
          await vi.waitFor(() => expect(isPidAlive(workerPid)).toBe(false), { timeout: 10_000 })

          // Polled to a deadline rather than waitFor, so a regression reports the status it
          // settled on: without the retained completion the record folds to `unknown` here.
          const deadline = Date.now() + 10_000
          let settled: BackgroundTaskRecord | undefined
          while (Date.now() < deadline) {
            settled = await getDetachedBackgroundTask(storageDir, record.id)
            if (settled && settled.status !== 'running' && settled.status !== 'unknown') break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          expect(settled?.status).toBe('completed')
          expect(settled?.exitCode).toBe(0)
          await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
          expect(onExit.mock.calls[0][0].record.exitCode).toBe(0)
        } finally {
          try {
            process.kill(-record.pid, 'SIGKILL')
          } catch {
            // the group is already gone
          }
        }
      }
    )

    it.skipIf(process.platform === 'win32')(
      'does not adopt a leaderless group it cannot attribute to the task after a restart',
      async () => {
        // A record read after a restart owns nothing in memory, and a pgid is only a number:
        // this live group — a session whose leader exited while its worker kept running — is
        // exactly what a reused pgid looks like, so it must not be treated as the task's or
        // Stop/Kill would signal processes that are not the task's.
        const pidFile = path.join(storageDir, 'unowned-worker.pid')
        const leader = spawn(
          '/bin/sh',
          [
            '-c',
            `${nodeBin} -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 60_000)" "${pidFile}" &`
          ],
          { detached: true, stdio: 'ignore' }
        )
        leader.unref()
        let workerPid = 0
        try {
          await vi.waitFor(() => expect(isPidAlive(leader.pid!)).toBe(false), { timeout: 10_000 })
          await vi.waitFor(
            async () => {
              expect((await readFile(pidFile, 'utf8')).trim()).toMatch(/^\d+$/)
            },
            { timeout: 10_000 }
          )
          workerPid = Number((await readFile(pidFile, 'utf8')).trim())
          expect(isPidAlive(workerPid)).toBe(true)

          await writeFile(
            path.join(storageDir, 'bt-unowned.json'),
            JSON.stringify({
              id: 'bt-unowned',
              name: 'unowned',
              command: 'true',
              pid: leader.pid,
              cwd: storageDir,
              startedAt: new Date().toISOString(),
              logFile: path.join(storageDir, 'bt-unowned.log'),
              status: 'running',
              exitCode: null,
              signal: null
            })
          )

          const reconciled = await getDetachedBackgroundTask(storageDir, 'bt-unowned')
          expect(reconciled?.status).toBe('unknown')
          // Unattributable, so unreachable: the stop must not signal the group's live worker.
          await expect(stopDetachedBackgroundTask(storageDir, 'bt-unowned', true)).resolves.toBeUndefined()
          expect(isPidAlive(workerPid)).toBe(true)
        } finally {
          try {
            if (workerPid > 0) process.kill(workerPid, 'SIGKILL')
          } catch {
            // already gone
          }
        }
      }
    )

    it.skipIf(process.platform === 'win32')(
      'does not adopt a foreign group that took the pgid before the task was recorded',
      async () => {
        // The task's shell exits while an unrelated group already holds its pgid — the reuse that
        // a reaped leader leaves behind. Whatever then sits in the group is not the task's, and
        // adopting it at close would let Stop/Kill or a permanent agent deletion terminate work
        // this app never started.
        const foreignPid = 4_194_303
        let record: BackgroundTaskRecord | undefined
        const killSpy = vi.spyOn(process, 'kill')
        try {
          // The command exits on its own, so the close event — the moment the old code took the
          // group's live members as the task's own — is what this test drives.
          record = await startDetachedBackgroundTask({
            storageDir,
            command: `${nodeBin} -e "setTimeout(() => {}, 1_200)"`,
            cwd: storageDir
          })
          expect(isPidAlive(record.pid)).toBe(true)
          // From here the OS reports the task's pgid as a group this app never started. setpgid
          // refuses across sessions, so the table carries the model; the pid is one the OS will
          // never hand out, so nothing real is ever signalled.
          psSteer.read = (args) =>
            args[0] === '-axwwo' ? `${record!.pid} ${foreignPid} 1 S Mon Jan  1 00:00:00 2001\n` : null

          // The shell is gone and the foreign group holds the number: the task must stay running
          // — it has live members by number only — and unattributable.
          await vi.waitFor(() => expect(isPidAlive(record!.pid)).toBe(false), { timeout: 10_000 })
          expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('running')

          // No group signal may reach the worker that only shares the number.
          await expect(stopDetachedBackgroundTask(storageDir, record.id, true)).resolves.toBeUndefined()
          expect(killSpy.mock.calls.filter(([pid]) => pid < 0)).toEqual([])
          expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('running')
        } finally {
          psSteer.read = null
          killSpy.mockRestore()
          try {
            if (record) process.kill(-record.pid, 'SIGKILL')
          } catch {
            // already drained
          }
        }
      }
    )
  })

  // A pgid outlives the group it names: once the task's own members have drained from it the OS
  // is free to hand the number to processes this app never started, and the in-memory ownership
  // entry alone cannot tell those apart from the task. A stop may only signal a group whose live
  // members are verified as the task's own work — and must still reach the leaderless task this
  // app has been watching.
  describe('process identity before signalling', () => {
    // A worker that outlives its shell and publishes its pid where the test can read it.
    const stampedWorkerCommand = (pidFile: string) =>
      `${nodeBin} -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 60_000)" "${pidFile}" &`

    /** Reads the pid a worker published once it is running — never before it exists. */
    const readWorkerPid = async (pidFile: string): Promise<number> => {
      let pid = 0
      await vi.waitFor(
        async () => {
          const written = Number((await readFile(pidFile, 'utf8')).trim())
          expect(written).toBeGreaterThan(0)
          pid = written
        },
        { timeout: 10_000 }
      )
      return pid
    }

    afterEach(() => {
      psSteer.read = null
    })

    // The initial `ps -p` lookup that stamps the spawned leader is a one-shot call with a
    // one-second timeout, so a loaded runner can fail it. The task is then alive and recorded
    // while its identity was never established: the ownership map holds an empty member set, and
    // `verifyMembers` can only extend from a member it has already verified. Every later probe
    // succeeds and finds nothing to extend from, so Stop/Kill stays refused for the task's whole
    // life, restart has no persisted stamp to re-identify it, and a permanent agent deletion
    // cannot clean it up. Identity must be recoverable while the supervisor is verifiably alive.
    it.skipIf(process.platform === 'win32')(
      'recovers the identity of a task whose first ps lookup failed',
      async () => {
        // Fail the stamp lookup exactly once — the one at spawn — by throwing the way a timed-out
        // or ENOENT `ps` does. Returning null would only delegate to the real table.
        let stampLookups = 0
        psSteer.read = (args) => {
          if (args[0] === '-p') {
            stampLookups++
            if (stampLookups === 1) throw Object.assign(new Error('ps: command timed out'), { code: 'ETIMEDOUT' })
          }
          return null
        }

        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
          cwd: storageDir
        })
        // The start itself must not reject: the task is alive and its record was written.
        expect(record.pidStartTime).toBeTruthy()
        expect(isPidAlive(record.pid)).toBe(true)

        try {
          // Wait past the 250 ms poll interval, so any recovery the spawn set up has had its turn.
          await new Promise((resolve) => setTimeout(resolve, 750))

          expect((await stopDetachedBackgroundTask(storageDir, record.id, true))?.status).toBe('stopped')
          await vi.waitFor(() => expect(isPidAlive(record.pid)).toBe(false), { timeout: 10_000 })
        } finally {
          psSteer.read = null
          try {
            process.kill(-record.pid, 'SIGKILL')
          } catch {
            // already drained
          }
        }
      }
    )

    it.skipIf(process.platform === 'win32')(
      'stops a task whose start stamp ps padded for a single-digit day',
      async () => {
        // `ps -o lstart=` right-pads the day to two columns, so a task started on the 5th reads
        // `Mon Oct  5 …`; the group table is parsed field-wise and collapses that padding while the
        // single-pid query keeps it. Both must name the same instant in the same way, or the task's
        // own live leader fails the ownership check and Stop/Kill is refused.
        let signalled = false
        const padded = 'Mon Oct  5 12:34:56 2026'
        psSteer.read = (args) => {
          if (args[0] === '-p') return `${padded}\n`
          // Empty once the group signal has gone out, so the drain below is not held on a row this
          // test invented for the identity check.
          if (args[0] === '-axwwo') return signalled ? '' : `${record.pid} ${record.pid} 1 S ${padded}\n`
          return null
        }
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
          cwd: storageDir
        })
        expect(record.pidStartTime).toBeTruthy()

        const realKill = process.kill.bind(process)
        const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
          if (pid < 0) signalled = true
          return realKill(pid, signal)
        })
        try {
          expect((await stopDetachedBackgroundTask(storageDir, record.id, true))?.status).toBe('stopped')
        } finally {
          killSpy.mockRestore()
          psSteer.read = null
          try {
            process.kill(-record.pid, 'SIGKILL')
          } catch {
            // already drained
          }
        }
      }
    )

    it.skipIf(process.platform === 'win32')(
      'refuses to signal a group holding a member it cannot account for',
      async () => {
        const pidFile = path.join(storageDir, 'worker.pid')
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: stampedWorkerCommand(pidFile),
          cwd: storageDir
        })
        const workerPid = await readWorkerPid(pidFile)
        // The shell is gone but the task is not: this app has watched the member it left behind,
        // and Stop still reaches it — that is the working state the guard must leave intact.
        expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('running')

        // A member present by number only is exactly what a group that took the drained pgid
        // leaves behind: live work in the recorded group that nothing ties to the task. A foreign
        // group cannot be pushed into the pgid for real — setpgid refuses across sessions — so
        // this table is where the replacement group is modelled. The supervisor's own row is
        // omitted, which is the state a fully drained pgid hands to the next owner.
        psSteer.read = (args) => (args[0] === '-axwwo' ? `${record.pid} 4194303 1 S Mon Jan  1 00:00:00 2001\n` : null)

        try {
          // Without verified membership the stop must not send the group signal — it would reach
          // whatever holds the pgid now. The unresolved record stays and keeps its controls.
          await expect(stopDetachedBackgroundTask(storageDir, record.id, true)).resolves.toBeUndefined()
          expect(isPidAlive(workerPid)).toBe(true)
          expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('running')
        } finally {
          psSteer.read = null
          try {
            process.kill(workerPid, 'SIGKILL')
          } catch {
            // already reaped
          }
        }
      }
    )

    it.skipIf(process.platform === 'win32')('still stops the leaderless task this app has been watching', async () => {
      const pidFile = path.join(storageDir, 'own-worker.pid')
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: stampedWorkerCommand(pidFile),
        cwd: storageDir
      })
      const workerPid = await readWorkerPid(pidFile)

      try {
        // The guard must not cost legitimate leaderless control: every live member here is work
        // this task started, inside the group the supervisor still leads.
        expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('running')
        expect((await stopDetachedBackgroundTask(storageDir, record.id, true))?.status).toBe('stopped')
        await vi.waitFor(() => expect(isPidAlive(workerPid)).toBe(false), { timeout: 10_000 })
      } finally {
        try {
          process.kill(-record.pid, 'SIGKILL')
        } catch {
          // already drained
        }
      }
    })

    // A verified worker can fork a child and exit between two 250-ms pulses. The child stays in
    // the task's group but is reparented, so a parent-chain walk never reaches it — and a stop
    // that can only verify through a live parent returns without signalling while the task still
    // runs, which also makes permanent agent deletion throw.
    it.skipIf(process.platform === 'win32')(
      'keeps stopping a worker forked by a worker that has since exited',
      async () => {
        const pidFile = path.join(storageDir, 'handoff.pid')
        // Both processes are plain scripts on disk: nesting `-e` inside the shell command would
        // need quoting the POSIX shell cannot parse.
        await writeFile(path.join(storageDir, 'grandchild.cjs'), 'setInterval(() => {}, 60_000)\n')
        // The worker waits past the command's own exit — so the close event observes an empty
        // group — then forks the grandchild, publishes both pids, and exits between two pulses.
        // The grandchild is left reparented, with no parent in the group table to walk from.
        await writeFile(
          path.join(storageDir, 'worker.cjs'),
          [
            "const { spawn } = require('node:child_process')",
            "const fs = require('node:fs')",
            '// Script form, so the pid file and the grandchild script are argv[2] and argv[3].',
            'setTimeout(() => {',
            "  const grand = spawn(process.execPath, [process.argv[3]], { stdio: 'ignore' })",
            "  grand.on('error', (e) => fs.writeFileSync(process.argv[2], 'error ' + e.message))",
            '  grand.unref()',
            "  fs.writeFileSync(process.argv[2], [process.pid, grand.pid].join(' '))",
            '  process.exit(0)',
            '}, 2_000)'
          ].join('\n') + '\n'
        )
        // The command's shell backgrounds the worker and exits at once, so the close event — the
        // moment the old code took the group's live members as the task's own — observes a group
        // with nothing left in it. The worker is still in the group, and only then does it fork the
        // grandchild and exit between two pulses.
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} "${path.join(storageDir, 'worker.cjs')}" "${pidFile}" "${path.join(storageDir, 'grandchild.cjs')}" &`,
          cwd: storageDir
        })
        let workerPid = 0
        let grandchildPid = 0
        await vi.waitFor(
          async () => {
            const [worker, grandchild] = (await readFile(pidFile, 'utf8')).trim().split(/\s+/).map(Number)
            expect(Number.isInteger(worker) && worker > 0).toBe(true)
            expect(Number.isInteger(grandchild) && grandchild > 0).toBe(true)
            workerPid = worker
            grandchildPid = grandchild
          },
          { timeout: 10_000 }
        )
        // The intermediate worker has exited: only the reparented grandchild holds the group open.
        await vi.waitFor(() => expect(isPidAlive(workerPid)).toBe(false), { timeout: 10_000 })
        await vi.waitFor(() => expect(isPidAlive(grandchildPid)).toBe(true), { timeout: 10_000 })

        try {
          // The handoff must not cost the task its controls: the record stays running and Stop
          // reaches the group, or the task would be unkillable and its agent undeletable.
          expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('running')
          expect((await stopDetachedBackgroundTask(storageDir, record.id, true))?.status).toBe('stopped')
          await vi.waitFor(() => expect(isPidAlive(grandchildPid)).toBe(false), { timeout: 10_000 })
        } finally {
          try {
            process.kill(-record.pid, 'SIGKILL')
          } catch {
            // already drained
          }
        }
      }
    )

    it.skipIf(process.platform === 'win32')(
      'refuses to signal through a leader the OS handed to another process',
      async () => {
        // The leader pid can outlive the task and be handed to something else while this app
        // still holds the ownership entry. Only the start stamp recorded at spawn tells the two
        // apart, and a mismatch must take the whole signal with it — entry or no entry.
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
          cwd: storageDir
        })
        try {
          psSteer.read = (args) =>
            args[0] === '-p' && args[1] === String(record.pid) ? 'Mon Jan  1 00:00:00 2001\n' : null

          expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).toBe('unknown')
          await expect(stopDetachedBackgroundTask(storageDir, record.id, true)).resolves.toBeUndefined()
          expect(isPidAlive(record.pid)).toBe(true)
        } finally {
          psSteer.read = null
          try {
            process.kill(-record.pid, 'SIGKILL')
          } catch {
            // already drained
          }
        }
      }
    )

    // The identity check and the group signal are separated by a record write, and a write is a
    // promise: while it is in flight the task can exit and the OS can hand its pid and pgid to
    // processes this app never started. Nothing in the record lock preserves OS process identity,
    // so the check that ran before the write says nothing about what the pgid names now.
    it.skipIf(process.platform === 'win32')(
      'rechecks process identity after the record write, so a replacement group gets no signal',
      async () => {
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
          cwd: storageDir
        })
        const taskPid = record.pid
        expect(isPidAlive(taskPid)).toBe(true)
        expect(record.pidStartTime).toBeTruthy()

        // A bystander this app has nothing to do with, killed by the test alone.
        const bystander = spawn(nodeBin.replace(/^"|"$/g, ''), ['-e', 'setInterval(() => {}, 60_000)'], {
          stdio: 'ignore'
        })
        bystander.unref()
        await vi.waitFor(() => expect(isPidAlive(bystander.pid!)).toBe(true), { timeout: 10_000 })
        const bystanderPid = bystander.pid!

        const killSpy = vi.spyOn(process, 'kill')

        try {
          // Identity changes inside the window: from here on the OS reports the task's pid and
          // pgid as the bystander's, which is what pid/pgid reuse mid-write leaves behind.
          writeHook.onWrite = async (target) => {
            if (!target.endsWith(`${record.id}${BACKGROUND_TASK_RECORD_EXT}.${process.pid}.tmp`)) return
            writeHook.onWrite = null
            psSteer.read = (args) => {
              if (args[0] === '-p') return 'Mon Jan  1 00:00:00 2001\n'
              if (args[0] === '-axwwo') return `${taskPid} ${bystanderPid} 1 S Mon Jan  1 00:00:00 2001\n`
              return null
            }
          }

          const result = await stopDetachedBackgroundTask(storageDir, record.id, true)

          // The replacement group was never this task's to signal: no SIGKILL may reach it.
          const groupSignals = killSpy.mock.calls.filter(([pid]) => pid < 0)
          expect(groupSignals).toEqual([])
          expect(result).toBeUndefined()
          expect(isPidAlive(bystanderPid)).toBe(true)
          // The task itself is left alone as well — a stop that cannot be attributed is refused,
          // not delivered on the strength of a check that has since gone stale.
          expect(isPidAlive(taskPid)).toBe(true)
          expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).not.toBe('stopped')
        } finally {
          writeHook.onWrite = null
          psSteer.read = null
          killSpy.mockRestore()
          // The task's group first, so a shell that forked rather than exec'd leaves nothing
          // holding the temp directory; the bystander is this test's own to clean up.
          for (const target of [-taskPid, taskPid, bystanderPid]) {
            try {
              process.kill(target, 'SIGKILL')
            } catch {
              // already reaped
            }
          }
        }
      }
    )
  })

  describe('forced stop verification', () => {
    it.skipIf(process.platform === 'win32')(
      'withholds the stopped record while a group member survives the kill',
      async () => {
        // A delivered group SIGKILL proves nothing per member: with a privileged worker in the
        // group (an authorized noninteractive sudo), the shell dies while the worker survives
        // the credential check. Simulated here by a group signal that "succeeds" without
        // reaching any member — the state the verification must key on either way.
        const onExit = vi.fn()
        const record = await startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
          cwd: storageDir
        })
        const realKill = process.kill.bind(process)
        const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
          if (pid < 0) return true
          return realKill(pid, signal)
        })
        try {
          const withheld = await stopDetachedBackgroundTask(storageDir, record.id, true, onExit)

          // The survivor keeps the task running and controllable; nothing may announce it
          // stopped while a live member remains.
          expect(withheld?.status).toBe('running')
          expect(isPidAlive(record.pid)).toBe(true)
          expect(onExit).not.toHaveBeenCalled()
        } finally {
          killSpy.mockRestore()
        }

        const stopped = await stopDetachedBackgroundTask(storageDir, record.id, true, onExit)
        expect(stopped?.status).toBe('stopped')
        expect(onExit).toHaveBeenCalledTimes(1)
        await vi.waitFor(() => expect(isPidAlive(record.pid)).toBe(false), { timeout: 10_000 })
      }
    )
  })

  describe('isPidAlive', () => {
    it('sees the current process as alive', () => {
      expect(isPidAlive(process.pid)).toBe(true)
    })
  })
})
