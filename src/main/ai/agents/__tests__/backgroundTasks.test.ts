import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BACKGROUND_TASK_SENTINEL_EXT,
  MAX_BACKGROUND_TASK_COMMAND_LENGTH,
  type BackgroundTaskRecord,
  buildDetachedBackgroundTaskSpawnOptions,
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
const failCommand = `${nodeBin} -e "process.exit(3)"`

describe('backgroundTasks', () => {
  let storageDir: string

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-tasks-'))
  })

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true })
  })

  describe('buildDetachedBackgroundTaskSpawnOptions', () => {
    it('detaches the child into its own session with the log fds wired to stdio', () => {
      const options = buildDetachedBackgroundTaskSpawnOptions('/workspace', 7, 7)
      expect(options.detached).toBe(true)
      expect(options.shell).toBe(true)
      expect(options.windowsHide).toBe(true)
      expect(options.cwd).toBe('/workspace')
      // stdin closed, stdout and stderr both point at the task log fd.
      expect(options.stdio).toEqual(process.platform === 'win32' ? ['ignore', 'ignore', 'ignore'] : ['ignore', 7, 7])
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
        command: okCommand,
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
