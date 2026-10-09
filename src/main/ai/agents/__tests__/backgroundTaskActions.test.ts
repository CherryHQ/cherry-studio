import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock, sendMessageMock, sendMessageOtherMock, getAgentAdaptersMock } = vi.hoisted(() => ({
  getPathMock: vi.fn(),
  sendMessageMock: vi.fn<(chatId: string, message: string) => Promise<void>>(async () => undefined),
  sendMessageOtherMock: vi.fn<(chatId: string, message: string) => Promise<void>>(async () => undefined),
  getAgentAdaptersMock: vi.fn<() => unknown[]>(() => [])
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: vi.fn(() => null) } }))
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
  purgeAgentBackgroundTasks,
  startAgentBackgroundTask,
  stopAgentBackgroundTask,
  stopAllAgentBackgroundTasks
} from '../backgroundTaskActions'
import * as tasks from '../backgroundTasks'
import { getDetachedBackgroundTask, startDetachedBackgroundTask, stopDetachedBackgroundTask } from '../backgroundTasks'

// Double quotes survive both POSIX sh and cmd.exe, including spaced paths.
const nodeBin = `"${process.execPath}"`

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
    await rm(agentsRoot, { recursive: true, force: true })
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
    await rm(agentsRoot, { recursive: true, force: true })
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
    await rm(agentsRoot, { recursive: true, force: true })
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
})
