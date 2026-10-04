import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock, sendMessageMock, getAgentAdaptersMock } = vi.hoisted(() => ({
  getPathMock: vi.fn(),
  sendMessageMock: vi.fn<(chatId: string, message: string) => Promise<void>>(async () => undefined),
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
    getAgentAdaptersMock.mockReturnValue([])
  })

  afterEach(async () => {
    await rm(agentsRoot, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('announces a kill on the channels watching the Agent', async () => {
    // The panel's Stop/Kill reaches the same completion hook the Agent tools use, so a force-kill
    // from the GUI cannot leave a chat watching the Agent believing the task is still running.
    getAgentAdaptersMock.mockReturnValue([
      { channelId: 'channel-1', notifyChatIds: ['chat-1'], sendMessage: sendMessageMock }
    ])
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
      cwd: storageDir
    })

    const stopped = await stopAgentBackgroundTask('agent-1', record.id, true)

    expect(stopped?.status).toBe('stopped')
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    const [chatId, summary] = sendMessageMock.mock.calls[0]
    expect(chatId).toBe('chat-1')
    expect(summary).toContain(record.id)
  })
})
