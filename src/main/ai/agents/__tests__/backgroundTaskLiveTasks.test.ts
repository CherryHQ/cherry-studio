import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: vi.fn(() => null) } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { application } = mockApplicationFactory()
  application.getPath = getPathMock
  return { application }
})

import { listLiveDetachedBackgroundTasks } from '../backgroundTaskActions'
import { getDetachedBackgroundTask, listDetachedBackgroundTasks, startDetachedBackgroundTask } from '../backgroundTasks'

const nodeBin = `"${process.execPath}"`

describe('listLiveDetachedBackgroundTasks', () => {
  let agentsRoot: string
  let storageDir: string

  beforeEach(async () => {
    agentsRoot = await mkdtemp(path.join(tmpdir(), 'cherry-live-tasks-'))
    storageDir = path.join(agentsRoot, 'agent-1', 'background-tasks')
    await mkdir(storageDir, { recursive: true })
    getPathMock.mockReturnValue(agentsRoot)
  })

  afterEach(async () => {
    const deadline = Date.now() + 10_000
    for (;;) {
      try {
        await rm(agentsRoot, { recursive: true, force: true })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM') throw error
        if (Date.now() >= deadline) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }, 15_000)

  /** Writes a running record the way the last session left it: no sentinel, status unsettled. */
  async function writeRunningRecord(id: string, pid: number): Promise<void> {
    await writeFile(
      path.join(storageDir, `${id}.json`),
      JSON.stringify({
        id,
        name: id,
        command: 'true',
        pid,
        cwd: storageDir,
        startedAt: new Date().toISOString(),
        logFile: path.join(storageDir, `${id}.log`),
        status: 'running',
        exitCode: null,
        signal: null
      })
    )
  }

  /** A detached group whose leader backgrounds its worker and exits at once, as the app's own do. */
  function spawnLeader(script: string): number {
    const leader = spawn('/bin/sh', ['-c', `${script} &`], { detached: true, stdio: 'ignore' })
    leader.unref()
    return leader.pid!
  }

  /** Waits until nothing in the process table still claims `pgid` — zombies and leftovers alike. */
  async function waitForGroupAbsent(pgid: number): Promise<void> {
    await vi.waitFor(
      () => {
        const table = execFileSync('ps', ['-axwwo', 'pgid=,pid=,ppid=,state=,lstart='], { encoding: 'utf8' })
        const rows = table.split('\n').filter((row) => row.trim().split(/\s+/)[0] === String(pgid))
        expect(rows).toEqual([])
      },
      { timeout: 10_000 }
    )
  }

  it.skipIf(process.platform === 'win32')('reports a task still running in this app as live', async () => {
    await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })

    const live = await listLiveDetachedBackgroundTasks()
    expect(live).toHaveLength(1)
    expect(live[0].agentId).toBe('agent-1')

    await listDetachedBackgroundTasks(storageDir)
    for (const record of await listDetachedBackgroundTasks(storageDir)) {
      try {
        process.kill(-record.pid, 'SIGKILL')
      } catch {
        // already drained
      }
    }
  })

  it.skipIf(process.platform === 'win32')(
    'does not report a task whose whole group has exited, so restore is not blocked forever',
    async () => {
      // The reviewer's sequence: the app was closed while the group finished, so there is no
      // completion callback and therefore no sentinel — reconciliation can only answer `unknown`
      // for a process that is gone. It must not read as live work, or `LegacyBackupManager` refuses
      // every restore while Stop rejects `unknown` records and the panel hides their controls.
      const leaderPid = spawnLeader(`${nodeBin} -e "setTimeout(() => {}, 200)"`)
      await waitForGroupAbsent(leaderPid)
      await writeRunningRecord('bt-drained', leaderPid)

      // The precondition: reconciled without a sentinel, so it is neither running nor finished.
      expect((await getDetachedBackgroundTask(storageDir, 'bt-drained'))?.status).toBe('unknown')
      expect(await listLiveDetachedBackgroundTasks()).toEqual([])
    }
  )

  it('reports an empty inventory when the Agents root is confirmed absent', async () => {
    // A fresh install has no Agents directory yet: that is the one absence restore may act on.
    getPathMock.mockReturnValue(path.join(agentsRoot, 'missing'))

    await expect(listLiveDetachedBackgroundTasks()).resolves.toEqual([])
  })

  it('does not report an empty inventory when the Agents root cannot be read', async () => {
    // Restore treats empty as "no live detached task" and deletes every record it holds, so a read
    // failure — which proves nothing about what is running — must reach it as a failure.
    const notADirectory = path.join(agentsRoot, 'agents-file')
    await writeFile(notADirectory, 'placeholder')
    getPathMock.mockReturnValue(notADirectory)

    await expect(listLiveDetachedBackgroundTasks()).rejects.toThrow('Failed to inventory detached background tasks')
  })

  it('does not report an empty inventory when an agent task directory cannot be read', async () => {
    await rm(storageDir, { recursive: true })
    await writeFile(storageDir, 'placeholder')

    await expect(listLiveDetachedBackgroundTasks()).rejects.toThrow()
  })

  it('does not report an empty inventory when a task record cannot be read', async () => {
    // A record that exists but cannot be parsed may still describe live work; reading this as
    // "no tasks" would let promotion delete its record and index out from under the process.
    await writeFile(path.join(storageDir, 'bt-corrupt.json'), '{ not json')

    await expect(listLiveDetachedBackgroundTasks()).rejects.toThrow('Failed to read background task record')
  })

  it.skipIf(process.platform === 'win32')('reports a task whose group still holds a live member as live', async () => {
    // Same absence of a sentinel, but a worker is still running inside the group: promotion would
    // delete the record while real work continues, so the restore must still be refused.
    const pidFile = path.join(storageDir, 'survivor.pid')
    const leaderPid = spawnLeader(
      `${nodeBin} -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 60_000)" "${pidFile}"`
    )
    await vi.waitFor(() => expect(execFileSync('ps', ['-p', String(leaderPid)], { encoding: 'utf8' })).toBeTruthy(), {
      timeout: 10_000
    })
    let survivorPid = 0
    try {
      await vi.waitFor(
        async () => {
          const written = Number((await readFile(pidFile, 'utf8')).trim())
          expect(written).toBeGreaterThan(0)
          survivorPid = written
        },
        { timeout: 10_000 }
      )
      await writeRunningRecord('bt-survivor', leaderPid)

      expect((await getDetachedBackgroundTask(storageDir, 'bt-survivor'))?.status).toBe('unknown')
      const live = await listLiveDetachedBackgroundTasks()
      expect(live.map((task) => task.id)).toEqual(['bt-survivor'])
    } finally {
      try {
        process.kill(survivorPid, 'SIGKILL')
      } catch {
        // already reaped
      }
    }
  })
})
