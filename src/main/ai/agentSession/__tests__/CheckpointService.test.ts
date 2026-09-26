import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)

const { appGetMock, broadcastToTypeMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  broadcastToTypeMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: appGetMock,
    getPath: (key: string, ...rest: string[]) => path.join('/mock-checkpoints-root', key, ...rest)
  }
}))

const { CheckpointService } = await import('../CheckpointService')
const { BaseService } = await import('@main/core/lifecycle')

beforeEach(() => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'IpcApiService') return { broadcastToType: broadcastToTypeMock }
    throw new Error(`Unexpected application.get(${name})`)
  })
})

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function initGitRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '--quiet'])
  await git(cwd, ['config', 'user.email', 'test@example.com'])
  await git(cwd, ['config', 'user.name', 'Test'])
}

describe('CheckpointService', () => {
  it('restores a git workspace to its exact pre-turn state (tracked edit + untracked file + turn-created files)', async () => {
    const cwd = await makeTempDir('cs-git-')
    await initGitRepo(cwd)
    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'committed content\n')
    await git(cwd, ['add', '.'])
    await git(cwd, ['commit', '--quiet', '-m', 'initial'])

    // Pre-turn state: an uncommitted edit to the tracked file, plus an untracked file.
    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'pre-turn uncommitted edit\n')
    await fs.writeFile(path.join(cwd, 'pre-turn-untracked.txt'), 'pre-turn untracked\n')

    const service = new CheckpointService()
    await service.createCheckpoint('session-1', cwd)

    expect(await fs.readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('pre-turn uncommitted edit\n')
    expect(await fs.readFile(path.join(cwd, 'pre-turn-untracked.txt'), 'utf8')).toBe('pre-turn untracked\n')
    expect(service.status('session-1')).toEqual({ available: true, createdAt: expect.any(Number) })

    // Simulate the agent's turn: further edits, a new file, and deleting the pre-turn untracked file.
    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'agent overwrote this\n')
    await fs.writeFile(path.join(cwd, 'agent-created.txt'), 'agent output\n')
    await fs.rm(path.join(cwd, 'pre-turn-untracked.txt'))

    const result = await service.restore('session-1')

    expect(result).toEqual({ restored: true })
    expect(await fs.readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('pre-turn uncommitted edit\n')
    expect(await fs.readFile(path.join(cwd, 'pre-turn-untracked.txt'), 'utf8')).toBe('pre-turn untracked\n')
    await expect(fs.access(path.join(cwd, 'agent-created.txt'))).rejects.toThrow()
    expect(service.status('session-1')).toEqual({ available: false })
  })

  it('restores a git workspace that was already clean at checkpoint time (no stash needed)', async () => {
    const cwd = await makeTempDir('cs-git-clean-')
    await initGitRepo(cwd)
    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'committed content\n')
    await git(cwd, ['add', '.'])
    await git(cwd, ['commit', '--quiet', '-m', 'initial'])

    const service = new CheckpointService()
    await service.createCheckpoint('session-2', cwd)
    expect(service.status('session-2').available).toBe(true)

    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'agent overwrote this\n')
    await fs.writeFile(path.join(cwd, 'agent-created.txt'), 'agent output\n')

    await service.restore('session-2')

    expect(await fs.readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('committed content\n')
    await expect(fs.access(path.join(cwd, 'agent-created.txt'))).rejects.toThrow()
  })

  it('falls back to a directory copy for a non-git workspace', async () => {
    const cwd = await makeTempDir('cs-files-')
    await fs.writeFile(path.join(cwd, 'note.txt'), 'pre-turn note\n')
    await fs.mkdir(path.join(cwd, 'sub'))
    await fs.writeFile(path.join(cwd, 'sub', 'nested.txt'), 'nested pre-turn\n')

    const service = new CheckpointService()
    await service.createCheckpoint('session-3', cwd)
    expect(service.status('session-3').available).toBe(true)

    await fs.writeFile(path.join(cwd, 'note.txt'), 'agent overwrote this\n')
    await fs.rm(path.join(cwd, 'sub'), { recursive: true, force: true })
    await fs.writeFile(path.join(cwd, 'agent-created.txt'), 'agent output\n')

    const result = await service.restore('session-3')

    expect(result).toEqual({ restored: true })
    expect(await fs.readFile(path.join(cwd, 'note.txt'), 'utf8')).toBe('pre-turn note\n')
    expect(await fs.readFile(path.join(cwd, 'sub', 'nested.txt'), 'utf8')).toBe('nested pre-turn\n')
    await expect(fs.access(path.join(cwd, 'agent-created.txt'))).rejects.toThrow()
  })

  it('reports unavailable and does not throw when no checkpoint exists', async () => {
    const service = new CheckpointService()
    expect(service.status('unknown-session')).toEqual({ available: false })
    await expect(service.restore('unknown-session')).resolves.toEqual({ restored: false })
  })

  it('swallows a checkpoint-creation failure instead of blocking the turn', async () => {
    const service = new CheckpointService()
    await expect(
      service.createCheckpoint('session-4', path.join(os.tmpdir(), 'cherry-cs-does-not-exist'))
    ).resolves.toBeUndefined()
    expect(service.status('session-4')).toEqual({ available: false })
  })

  it('broadcasts availability to the renderer on create and on restore', async () => {
    const cwd = await makeTempDir('cs-broadcast-')
    await initGitRepo(cwd)
    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'committed\n')
    await git(cwd, ['add', '.'])
    await git(cwd, ['commit', '--quiet', '-m', 'initial'])

    const service = new CheckpointService()
    await service.createCheckpoint('session-5', cwd)
    expect(broadcastToTypeMock).toHaveBeenCalledWith(
      expect.anything(),
      'agent_checkpoint.updated',
      expect.objectContaining({ sessionId: 'session-5', available: true })
    )

    await service.restore('session-5')
    expect(broadcastToTypeMock).toHaveBeenCalledWith(
      expect.anything(),
      'agent_checkpoint.updated',
      expect.objectContaining({ sessionId: 'session-5', available: false })
    )
  })
})
