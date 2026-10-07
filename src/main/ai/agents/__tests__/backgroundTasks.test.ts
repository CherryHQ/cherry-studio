import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BACKGROUND_TASK_SENTINEL_EXT,
  MAX_BACKGROUND_TASK_COMMAND_LENGTH,
  type BackgroundTaskRecord,
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

    it.skipIf(process.platform === 'win32')('runs the command in a shell on POSIX', () => {
      const { file, args, options } = buildDetachedBackgroundTaskSpawn('echo hi', '/workspace', 7, 7)
      expect(file).toBe('echo hi')
      expect(args).toEqual([])
      expect(options.shell).toBe(true)
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

  describe('isPidAlive', () => {
    it('sees the current process as alive', () => {
      expect(isPidAlive(process.pid)).toBe(true)
    })
  })
})
