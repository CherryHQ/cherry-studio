import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: vi.fn(() => null) } }))
vi.mock('@application', () => ({ application: { getPath: getPathMock } }))

import { agentService } from '@data/services/AgentService'

import {
  purgeAgentBackgroundTasks,
  startAgentBackgroundTask,
  stopAllAgentBackgroundTasks
} from '../backgroundTaskActions'
import { getDetachedBackgroundTask, startDetachedBackgroundTask } from '../backgroundTasks'

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
