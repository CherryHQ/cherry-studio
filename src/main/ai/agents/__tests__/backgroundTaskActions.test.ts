import { execFileSync, spawn } from 'node:child_process'
import type * as FsPromisesModule from 'node:fs/promises'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { logOpenGate } = vi.hoisted(() => ({
  logOpenGate: {
    armed: false,
    reached: undefined as (() => void) | undefined,
    release: undefined as (() => void) | undefined
  }
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromisesModule>()
  const actualOpen = actual.open as (...args: never[]) => unknown
  return {
    ...actual,
    open: async (file: string, flags: string, mode?: number) => {
      if (logOpenGate.armed && file.endsWith('.log')) {
        logOpenGate.armed = false
        logOpenGate.reached?.()
        await new Promise<void>((resolve) => {
          logOpenGate.release = resolve
        })
      }
      return actualOpen(file as never, flags as never, mode as never)
    }
  }
})

const { getPathMock, sendMessageMock, sendMessageOtherMock, getAgentAdaptersMock, taskIndexMocks } = vi.hoisted(() => ({
  getPathMock: vi.fn(),
  sendMessageMock: vi.fn<(chatId: string, message: string) => Promise<void>>(async () => undefined),
  sendMessageOtherMock: vi.fn<(chatId: string, message: string) => Promise<void>>(async () => undefined),
  getAgentAdaptersMock: vi.fn<() => unknown[]>(() => []),
  taskIndexMocks: {
    saveRecord: vi.fn(),
    saveRecords: vi.fn(),
    listByAgent: vi.fn()
  }
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: vi.fn(() => null) } }))
vi.mock('@data/services/AgentBackgroundTaskService', () => ({
  agentBackgroundTaskService: taskIndexMocks
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { application } = mockApplicationFactory({
    ChannelManager: { getAgentAdapters: getAgentAdaptersMock }
  } as Parameters<typeof mockApplicationFactory>[0])
  application.getPath = getPathMock
  return { application }
})

import { agentService } from '@data/services/AgentService'

import {
  DetachedTasksBusyError,
  listAgentBackgroundTasks,
  purgeAgentBackgroundTasks,
  startAgentBackgroundTask,
  stopAgentBackgroundTask,
  stopAllAgentBackgroundTasks,
  withDetachedTasksStopped,
  workspaceHasLiveDetachedTasks
} from '../backgroundTaskActions'
import * as tasks from '../backgroundTasks'
import {
  getDetachedBackgroundTask,
  isPidAlive,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask,
  type BackgroundTaskRecord
} from '../backgroundTasks'

// Double quotes survive both POSIX sh and cmd.exe, including spaced paths.
const nodeBin = `"${process.execPath}"`
// A worker that starts its own session and scrubs its environment is expressed through python3.
const python3Available =
  process.platform !== 'win32' &&
  (() => {
    try {
      execFileSync('python3', ['--version'], { stdio: 'ignore', timeout: 5_000 })
      return true
    } catch {
      return false
    }
  })()

// A worker that outlives its shell: it installs a SIGTERM handler, prints its pid, and keeps
// running inside the detached group after the shell exits. The supervisor outlives the shell by
// design, so its pid staying alive says nothing about the work.
const orphanWorkerCommand = `${nodeBin} -e "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid)); setInterval(() => {}, 60_000)" &`

/**
 * Removes the test's tree once nothing is writing into it. A completion still in flight drops its
 * staging file after `rm`'s readdir but before its rmdir — which is ENOTEMPTY, and `force` only
 * suppresses ENOENT — so the removal is retried until it lands.
 */
async function rmTaskDir(agentsRoot: string): Promise<void> {
  await vi.waitFor(async () => await rm(agentsRoot, { recursive: true, force: true }), {
    timeout: 10_000,
    interval: 50
  })
}

/** Waits for the shell to exit and returns the surviving worker's pid. */
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

/** A disk record that reconciles as running: live pid, no start stamp, no completion evidence. */
async function writeRunningRecord(storageDir: string, id: string): Promise<void> {
  await writeFile(
    path.join(storageDir, `${id}.json`),
    JSON.stringify({
      id,
      name: id,
      command: 'true',
      pid: process.pid,
      cwd: storageDir,
      startedAt: new Date().toISOString(),
      logFile: path.join(storageDir, `${id}.log`),
      status: 'running',
      exitCode: null,
      signal: null
    })
  )
}

async function writeCompletionSentinel(storageDir: string, id: string): Promise<void> {
  await writeFile(
    path.join(storageDir, `${id}.done`),
    JSON.stringify({
      id,
      status: 'completed',
      exitCode: 0,
      signal: null,
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      logFile: path.join(storageDir, `${id}.log`)
    })
  )
}

describe('withDetachedTasksStopped', () => {
  let agentsRoot: string
  let storageDir: string

  beforeEach(async () => {
    agentsRoot = await mkdtemp(path.join(tmpdir(), 'cherry-agents-'))
    storageDir = path.join(agentsRoot, 'agent-1', 'background-tasks')
    await mkdir(storageDir, { recursive: true })
    getPathMock.mockReturnValue(agentsRoot)
  })

  afterEach(async () => {
    await rmTaskDir(agentsRoot)
  })

  it('refuses staging while a task it could not stop is still live', async () => {
    // Data Reset erases the record, log and workspace the task runs in. A task whose identity
    // cannot be established here must block the reset rather than be erased and left running.
    await writeRunningRecord(storageDir, 'bt-unverifiable')
    let committed = false

    await expect(
      withDetachedTasksStopped(async () => {
        committed = true
      })
    ).rejects.toBeInstanceOf(DetachedTasksBusyError)
    expect(committed).toBe(false)
  })

  it('drains a start admitted before admission closed before inventorying what to stop', async () => {
    // A start can pass both admission checks and then sit in its log open, with no record for the
    // inventory to find. Closing admission does not touch that start, so a sweep that lists first
    // finds nothing, commits, and lets the start spawn afterwards — after the reset erased the
    // record, log and workspace that were its only control path.
    vi.mocked(agentService.getAgent).mockReturnValue({ id: 'agent-1' } as never)
    const order: string[] = []
    const reached = new Promise<void>((resolve) => {
      logOpenGate.reached = resolve
    })
    logOpenGate.armed = true
    const started = startAgentBackgroundTask({
      agentId: 'agent-1',
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => {}, 5_000)"`,
      cwd: storageDir
    })
    try {
      await reached
      // Admitted, and past the checks: the inventory has no record to find yet. (The runner writes
      // its own task file before the log opens, so the directory is not empty on Windows.)
      await expect(tasks.listDetachedBackgroundTasks(storageDir)).resolves.toEqual([])

      const resetting = withDetachedTasksStopped(async () => {
        order.push('commit')
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(order).toEqual([])

      logOpenGate.release?.()
      const record = await started
      await resetting

      // The sweep saw the record the start wrote and stopped the task before the commit.
      expect(order).toEqual(['commit'])
      await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.not.toMatchObject({
        status: 'running'
      })
    } finally {
      logOpenGate.armed = false
      logOpenGate.release?.()
      vi.mocked(agentService.getAgent).mockReturnValue(null)
      await stopAllAgentBackgroundTasks('agent-1').catch(() => undefined)
    }
  })

  it('closes task admission while it runs and reopens it afterwards', async () => {
    await withDetachedTasksStopped(async () => {
      await expect(
        startAgentBackgroundTask({ agentId: 'agent-1', storageDir, command: 'echo hi', cwd: storageDir })
      ).rejects.toThrow(/data reset is stopping/)
    })
    // Admission is open again: the start gets past that gate and fails on the mocked agent instead.
    await expect(
      startAgentBackgroundTask({ agentId: 'agent-1', storageDir, command: 'echo hi', cwd: storageDir })
    ).rejects.toThrow(/Agent agent-1 not found/)
  })
})

describe('stopAllAgentBackgroundTasks', () => {
  let agentsRoot: string
  let storageDir: string

  beforeEach(async () => {
    agentsRoot = await mkdtemp(path.join(tmpdir(), 'cherry-agents-'))
    storageDir = path.join(agentsRoot, 'agent-1', 'background-tasks')
    await mkdir(storageDir, { recursive: true })
    getPathMock.mockReturnValue(agentsRoot)
  })

  afterEach(async () => {
    await rmTaskDir(agentsRoot)
  })

  it.skipIf(process.platform === 'win32')(
    'force-stops a trashed Agent task before purge removes its control path',
    async () => {
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
        cwd: storageDir
      })

      await stopAllAgentBackgroundTasks('agent-1')

      await vi.waitFor(async () => {
        const stopped = await getDetachedBackgroundTask(storageDir, record.id)
        expect(stopped?.status).toBe('stopped')
        expect(stopped?.stopSignal).toBe('SIGKILL')
      })
    }
  )

  it.skipIf(process.platform === 'win32')("stops an agent's tasks concurrently rather than one at a time", async () => {
    // Each stop shells out synchronously to the platform, so a serial sweep holds the main
    // process for the sum of every task's liveness probe. The contract is that the stops overlap.
    const stopSpy = vi.spyOn(tasks, 'stopDetachedBackgroundTask')
    let inFlight = 0
    let peak = 0
    stopSpy.mockImplementation(async (_dir, id) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight -= 1
      return { ...records[0], id, status: 'stopped' as const }
    })
    const records = await Promise.all(
      [0, 1, 2].map(() =>
        startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
          cwd: storageDir
        })
      )
    )

    try {
      await stopAllAgentBackgroundTasks('agent-1')
      expect(peak).toBe(records.length)
    } finally {
      // The spy stands in for the sweep, so the three real children it was measuring over are still
      // running: they are detached, nothing else reaps them, and the suite is what created them.
      stopSpy.mockRestore()
      await Promise.all(records.map((record) => stopDetachedBackgroundTask(storageDir, record.id, true)))
    }
  })

  it.skipIf(process.platform === 'win32')(
    'completes the purge when a task finishes between listing and stopping it',
    async () => {
      // A record the sweep lists as running (live pid, no completion yet) whose task exits right
      // as the stop runs: the stop's own reconcile then reads a terminal record and returns
      // undefined, which must not abort the permanent delete of an already-finished task.
      await writeRunningRecord(storageDir, 'bt-race')
      const stopSpy = vi.spyOn(tasks, 'stopDetachedBackgroundTask')
      stopSpy.mockImplementation(async (dir, id) => {
        await writeCompletionSentinel(dir, id)
        return undefined
      })
      try {
        await expect(stopAllAgentBackgroundTasks('agent-1')).resolves.toBeUndefined()
      } finally {
        stopSpy.mockRestore()
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'still refuses the purge while a listed task stays live and unverifiable',
    async () => {
      // The pid is alive but the record carries no start stamp, so the stop cannot prove the
      // process is the task's and returns undefined without signalling it — the delete must refuse.
      await writeRunningRecord(storageDir, 'bt-unverifiable')
      await expect(stopAllAgentBackgroundTasks('agent-1')).rejects.toThrow(
        'Cannot permanently delete Agent agent-1 while background task bt-unverifiable is running'
      )
    }
  )

  it.skipIf(process.platform === 'win32')(
    'kills a leaderless task through its surviving group before the purge deletes it',
    async () => {
      // The shell (group leader) is gone and a SIGTERM-immune worker keeps running in its
      // group: the sweep must not mistake the dead leader for a finished task and delete the
      // agent's records while the survivor lives.
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: orphanWorkerCommand,
        cwd: storageDir
      })
      const workerPid = await waitForOrphanedWorker(record)

      try {
        await stopAllAgentBackgroundTasks('agent-1')

        await vi.waitFor(() => expect(isPidAlive(workerPid)).toBe(false), { timeout: 10_000 })
        const settled = await getDetachedBackgroundTask(storageDir, record.id)
        expect(settled?.status).toBe('stopped')
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
    'refuses the purge while a leaderless task keeps working in its group',
    async () => {
      // Same leaderless survivor, but a sweep whose kill takes no effect: the task still
      // reads as running, so the permanent delete must refuse rather than skip it.
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: orphanWorkerCommand,
        cwd: storageDir
      })
      await waitForOrphanedWorker(record)
      const stopSpy = vi.spyOn(tasks, 'stopDetachedBackgroundTask')
      stopSpy.mockImplementation(async () => undefined)
      try {
        await expect(stopAllAgentBackgroundTasks('agent-1')).rejects.toThrow(
          `Cannot permanently delete Agent agent-1 while background task ${record.id} is running`
        )
      } finally {
        stopSpy.mockRestore()
        try {
          process.kill(-record.pid, 'SIGKILL')
        } catch {
          // the group is already gone
        }
      }
    }
  )

  it('refuses the purge when a stop leaves the task running and stop-requested', async () => {
    // A Windows kill that cannot prove it reached a worker past its shell's exit hands back the
    // record still `running` — the shape the verified stop returns. The sweep must refuse and
    // leave the record, or the purge would delete the survivor's last tracking and index.
    await writeRunningRecord(storageDir, 'bt-unverified-kill')
    const stopSpy = vi.spyOn(tasks, 'stopDetachedBackgroundTask')
    stopSpy.mockImplementation(async (dir, id) => {
      const current = await getDetachedBackgroundTask(dir, id)
      return { ...current!, stopRequestedAt: new Date().toISOString() }
    })
    try {
      await expect(stopAllAgentBackgroundTasks('agent-1')).rejects.toThrow(
        'Cannot permanently delete Agent agent-1 while background task bt-unverified-kill is running'
      )
      expect(await readFile(path.join(storageDir, 'bt-unverified-kill.json'), 'utf8')).toContain('"running"')
    } finally {
      stopSpy.mockRestore()
    }
  })

  it.skipIf(process.platform === 'win32' || !python3Available)(
    'refuses the purge and keeps the workspace while a force kill leaves a scrubbed daemon alive',
    async () => {
      // The daemon leaves the group, closes the liveness pipes and scrubs the marker, so only the
      // stdio the anchor reads names it. A sweep that certified the kill would erase the record and
      // the workspace beneath work that is still running.
      const pidFile = path.join(storageDir, 'scrubbed-worker.pid')
      const record = await startDetachedBackgroundTask({
        storageDir,
        command:
          `python3 -c "import subprocess,sys; p=subprocess.Popen(['/bin/sleep','120'], start_new_session=True, env={}); open(sys.argv[1],'w').write(str(p.pid))" "${pidFile}"` +
          ` & sleep 0.6`,
        cwd: storageDir
      })
      let workerPid = 0
      try {
        await vi.waitFor(
          async () => {
            workerPid = Number((await readFile(pidFile, 'utf8')).trim())
            expect(workerPid).toBeGreaterThan(0)
          },
          { timeout: 10_000 }
        )
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        expect(isPidAlive(workerPid)).toBe(true)

        await expect(stopAllAgentBackgroundTasks('agent-1')).rejects.toThrow(
          `Cannot permanently delete Agent agent-1 while background task ${record.id} is running`
        )
        await expect(workspaceHasLiveDetachedTasks(storageDir)).resolves.toBe(true)
        expect(isPidAlive(workerPid)).toBe(true)
        expect(await readFile(path.join(storageDir, `${record.id}.json`), 'utf8')).toContain('"running"')
      } finally {
        try {
          if (workerPid > 0) process.kill(workerPid, 'SIGKILL')
        } catch {
          // already gone
        }
        // Let the survivor's exit settle the record before the tree is removed.
        await vi
          .waitFor(
            async () => {
              expect((await getDetachedBackgroundTask(storageDir, record.id))?.status).not.toBe('running')
            },
            { timeout: 10_000 }
          )
          .catch(() => {})
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'keeps an unattributable leaderless record through the purge refusal',
    async () => {
      // After a restart the app owns nothing in memory: a record whose leader is gone while
      // its pgid still holds live members — here a session built for exactly that shape — may
      // be guarding this task's own survivor, so the purge must refuse and leave the record
      // rather than sweep it away with the agent.
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

        await expect(stopAllAgentBackgroundTasks('agent-1')).rejects.toThrow(
          'Cannot permanently delete Agent agent-1 while background task bt-unowned is unresolved'
        )
        expect(isPidAlive(workerPid)).toBe(true)
        expect(await readFile(path.join(storageDir, 'bt-unowned.json'), 'utf8')).toContain('"running"')
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
    'refuses the purge when a post-restart force-stop leaves the task unresolved',
    async () => {
      // A restart owns nothing in memory, so a force-stop whose SIGKILL removes the supervisor it
      // had verified — while a privileged worker survives the group signal — can only report
      // `unknown`: reconciliation can no longer attribute the group. The sweep must re-read the
      // records the stops left behind, or the purge deletes the record and index of work that is
      // still running.
      const pidFile = path.join(storageDir, 'post-stop-worker.pid')
      // The leader stays alive while its worker runs, so the record reconciles as running until
      // the stop kills the leader alone — the shape a restart-verified supervisor leaves behind.
      const leader = spawn(
        '/bin/sh',
        [
          '-c',
          `${nodeBin} -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 60_000)" "${pidFile}" & wait`
        ],
        { detached: true, stdio: 'ignore' }
      )
      leader.unref()
      try {
        await vi.waitFor(
          async () => {
            expect((await readFile(pidFile, 'utf8')).trim()).toMatch(/^\d+$/)
          },
          { timeout: 10_000 }
        )
        const workerPid = Number((await readFile(pidFile, 'utf8')).trim())
        expect(isPidAlive(leader.pid!)).toBe(true)
        expect(isPidAlive(workerPid)).toBe(true)

        // No start stamp on the record: with the leader live the sweep lists it as running, and
        // the stop below stands in for the platform kill a privileged worker cannot be subjected
        // to here.
        await writeFile(
          path.join(storageDir, 'bt-restart-kill.json'),
          JSON.stringify({
            id: 'bt-restart-kill',
            name: 'restart-kill',
            command: 'true',
            pid: leader.pid,
            cwd: storageDir,
            startedAt: new Date().toISOString(),
            logFile: path.join(storageDir, 'bt-restart-kill.log'),
            status: 'running',
            exitCode: null,
            signal: null
          })
        )

        const stopSpy = vi.spyOn(tasks, 'stopDetachedBackgroundTask')
        stopSpy.mockImplementation(async (dir, id) => {
          const current = await getDetachedBackgroundTask(dir, id)
          // The group kill removes the supervisor; the privileged worker survives it. Reconciliation,
          // holding no ownership after the restart, reads a group it can no longer attribute.
          try {
            process.kill(leader.pid!, 'SIGKILL')
          } catch {
            // already gone
          }
          await vi.waitFor(() => expect(isPidAlive(leader.pid!)).toBe(false), { timeout: 10_000 })
          return { ...current!, id, status: 'unknown' as const }
        })
        try {
          await expect(stopAllAgentBackgroundTasks('agent-1')).rejects.toThrow(
            'Cannot permanently delete Agent agent-1 while background task bt-restart-kill is unresolved'
          )
          expect(isPidAlive(workerPid)).toBe(true)
        } finally {
          stopSpy.mockRestore()
        }
      } finally {
        try {
          process.kill(-leader.pid!, 'SIGKILL')
        } catch {
          // the group is already gone
        }
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses the purge for an unknown record whose marked worker left its group',
    async () => {
      // A restart followed by an external kill of the supervisor leaves the record `unknown` while
      // a worker that called setsid() keeps running: the recorded group no longer holds it, so a
      // group-only predicate reads it as already dead and the purge erases its last tracking.
      const id = 'bt-marked-survivor'
      await writeFile(
        path.join(storageDir, `${id}.json`),
        JSON.stringify({
          id,
          name: id,
          command: 'true',
          pid: 4_194_304,
          cwd: storageDir,
          startedAt: new Date().toISOString(),
          logFile: path.join(storageDir, `${id}.log`),
          status: 'unknown',
          exitCode: null,
          signal: null
        })
      )
      const survivor = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, CHERRY_BG_TASK_ID: id }
      })
      survivor.unref()
      try {
        await vi.waitFor(() => expect(isPidAlive(survivor.pid!)).toBe(true), { timeout: 5_000 })
        await expect(stopAllAgentBackgroundTasks('agent-1')).rejects.toThrow(
          `Cannot permanently delete Agent agent-1 while background task ${id} is unresolved`
        )
        expect(isPidAlive(survivor.pid!)).toBe(true)
      } finally {
        try {
          process.kill(survivor.pid!, 'SIGKILL')
        } catch {
          // already gone
        }
      }
    }
  )
})

describe('listAgentBackgroundTasks', () => {
  let agentsRoot: string
  let storageDir: string

  beforeEach(async () => {
    agentsRoot = await mkdtemp(path.join(tmpdir(), 'cherry-agents-list-'))
    storageDir = path.join(agentsRoot, 'agent-1', 'background-tasks')
    await mkdir(storageDir, { recursive: true })
    getPathMock.mockReturnValue(agentsRoot)
    vi.mocked(agentService.getAgent).mockReturnValue({ id: 'agent-1' } as never)
    taskIndexMocks.saveRecords.mockReset()
    taskIndexMocks.listByAgent.mockReset()
  })

  afterEach(async () => {
    await rmTaskDir(agentsRoot)
    vi.mocked(agentService.getAgent).mockReturnValue(null)
  })

  it('returns the reconciled disk records even while the index write is only deferred', async () => {
    // Inside a backup's pauseWrites hold the index accepts saveRecords without touching SQLite;
    // reading it back would show a completed task as running (or omit an unindexed one), and the
    // panel's Stop/Kill then acts against a stale record. The disk is the answer either way.
    const diskRecord: BackgroundTaskRecord = {
      id: 'bt-done',
      name: 'done',
      command: 'true',
      pid: 999_999,
      cwd: storageDir,
      startedAt: new Date().toISOString(),
      logFile: path.join(storageDir, 'bt-done.log'),
      status: 'completed',
      exitCode: 0,
      signal: null
    }
    await writeFile(path.join(storageDir, 'bt-done.json'), JSON.stringify(diskRecord))
    // Deferred, not failed: the call succeeds while the hold lasts, so the old read-back path
    // reached the stale rows below.
    taskIndexMocks.saveRecords.mockImplementation(() => undefined)
    taskIndexMocks.listByAgent.mockReturnValue([{ ...diskRecord, status: 'running' }])

    await expect(listAgentBackgroundTasks('agent-1')).resolves.toEqual([diskRecord])
    expect(taskIndexMocks.saveRecords).toHaveBeenCalledWith('agent-1', [diskRecord])
  })
})

describe('startAgentBackgroundTask / purgeAgentBackgroundTasks', () => {
  let agentsRoot: string
  let storageDir: string

  beforeEach(async () => {
    agentsRoot = await mkdtemp(path.join(tmpdir(), 'cherry-agents-'))
    storageDir = path.join(agentsRoot, 'agent-1', 'background-tasks')
    await mkdir(storageDir, { recursive: true })
    getPathMock.mockReturnValue(agentsRoot)
    vi.mocked(agentService.getAgent).mockReturnValue({ id: 'agent-1' } as never)
  })

  afterEach(async () => {
    await rmTaskDir(agentsRoot)
    vi.mocked(agentService.getAgent).mockReturnValue(null)
  })

  it('refuses to start a task for a missing Agent', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue(null)
    await expect(
      startAgentBackgroundTask({ agentId: 'agent-1', storageDir, command: 'echo hi', cwd: storageDir })
    ).rejects.toThrow('Agent agent-1 not found')
  })

  it('serializes a start behind a concurrent purge and refuses it once the Agent is gone', async () => {
    let releaseDeletion!: () => void
    const deletionGate = new Promise<void>((resolve) => {
      releaseDeletion = resolve
    })
    const purge = purgeAgentBackgroundTasks('agent-1', async () => {
      await deletionGate
      // Simulates the agent row going away before the queued start is admitted.
      vi.mocked(agentService.getAgent).mockReturnValue(null)
      return 'deleted'
    })

    const start = startAgentBackgroundTask({ agentId: 'agent-1', storageDir, command: 'echo hi', cwd: storageDir })
    releaseDeletion()

    await expect(purge).resolves.toBe('deleted')
    await expect(start).rejects.toThrow('Agent agent-1 not found')
    // No record leaked: the refused start never spawned a process into the purged dir.
    const entries = await readdir(storageDir).catch(() => [] as string[])
    expect(entries.filter((entry) => entry.endsWith('.json'))).toHaveLength(0)
  })
})

describe('stopAgentBackgroundTask', () => {
  let agentsRoot: string
  let storageDir: string

  beforeEach(async () => {
    agentsRoot = await mkdtemp(path.join(tmpdir(), 'cherry-agents-stop-'))
    storageDir = path.join(agentsRoot, 'agent-1', 'background-tasks')
    await mkdir(storageDir, { recursive: true })
    getPathMock.mockReturnValue(agentsRoot)
    vi.mocked(agentService.getAgent).mockReturnValue({ id: 'agent-1' } as never)
    sendMessageMock.mockClear()
    sendMessageOtherMock.mockClear()
    getAgentAdaptersMock.mockReturnValue([])
  })

  afterEach(async () => {
    await rmTaskDir(agentsRoot)
  })

  it.skipIf(process.platform === 'win32')(
    'announces a kill only to the recipients the starting turn authorized',
    async () => {
      // The panel's Stop/Kill reaches the same completion hook the Agent tools use. Delivery keeps
      // the record's persisted recipient scope: a channel the start never authorized hears nothing.
      getAgentAdaptersMock.mockReturnValue([
        { channelId: 'channel-1', notifyChatIds: ['chat-1'], sendMessage: sendMessageMock },
        { channelId: 'channel-2', notifyChatIds: ['chat-2'], sendMessage: sendMessageOtherMock }
      ])
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
        cwd: storageDir,
        notifyChannelIds: ['channel-1']
      })

      const stopped = await stopAgentBackgroundTask('agent-1', record.id, true)

      expect(stopped?.status).toBe('stopped')
      expect(sendMessageMock).toHaveBeenCalledTimes(1)
      const [chatId, summary] = sendMessageMock.mock.calls[0]
      expect(chatId).toBe('chat-1')
      expect(summary).toContain(record.id)
      expect(sendMessageOtherMock).not.toHaveBeenCalled()
    }
  )

  it.skipIf(process.platform === 'win32')('stays silent on kill when the start authorized no recipients', async () => {
    getAgentAdaptersMock.mockReturnValue([
      { channelId: 'channel-1', notifyChatIds: ['chat-1'], sendMessage: sendMessageMock }
    ])
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
      cwd: storageDir,
      notifyChannelIds: []
    })

    await stopAgentBackgroundTask('agent-1', record.id, true)

    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'redacts credential-shaped task names before they reach a channel',
    async () => {
      // The task name is unrestricted input and the summary interpolates it verbatim; the
      // delivery boundary must redact what ordinary notify redacts, not hand it to the chat.
      getAgentAdaptersMock.mockReturnValue([
        { channelId: 'channel-1', notifyChatIds: ['chat-1'], sendMessage: sendMessageMock }
      ])
      const record = await startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
        cwd: storageDir,
        name: 'token=syntheticCredential123456',
        notifyChannelIds: ['channel-1']
      })

      await stopAgentBackgroundTask('agent-1', record.id, true)

      expect(sendMessageMock).toHaveBeenCalledTimes(1)
      const summary = sendMessageMock.mock.calls[0][1]
      expect(summary).toContain(record.id)
      expect(summary).toContain('[REDACTED]')
      expect(summary).not.toContain('syntheticCredential123456')
    }
  )
})
