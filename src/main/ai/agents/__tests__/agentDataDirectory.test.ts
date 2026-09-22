import { existsSync, lstatSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_ID = '11111111-1111-4111-8111-111111111111'
let agentsDataRoot = ''

const {
  assertAgentStorageDirectory,
  createAgentDataDirectory,
  ensureAgentDataDirectory,
  removeAgentStorageSubdirectory
} = await import('../agentDataDirectory')

describe('agentDataDirectory', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    agentsDataRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-create-'))
  })

  afterEach(async () => {
    await rm(agentsDataRoot, { recursive: true, force: true })
  })

  it('creates real identity and memory paths', async () => {
    const result = await createAgentDataDirectory(agentsDataRoot, AGENT_ID)
    const agentPath = path.join(agentsDataRoot, AGENT_ID)

    expect(result).toBe(agentPath)
    expect(lstatSync(path.join(agentPath, 'SOUL.md')).isFile()).toBe(true)
    expect(lstatSync(path.join(agentPath, 'USER.md')).isFile()).toBe(true)
    expect(lstatSync(path.join(agentPath, 'memory')).isDirectory()).toBe(true)
    expect(await readFile(path.join(agentPath, 'SOUL.md'), 'utf-8')).toBe('')
  })

  it('converges when concurrent initializers create the same identity files', async () => {
    const agentPath = path.join(agentsDataRoot, AGENT_ID)
    await mkdir(path.join(agentPath, 'memory'), { recursive: true })

    await expect(
      Promise.all([
        ensureAgentDataDirectory(agentsDataRoot, AGENT_ID),
        ensureAgentDataDirectory(agentsDataRoot, AGENT_ID)
      ])
    ).resolves.toEqual([agentPath, agentPath])

    expect(lstatSync(path.join(agentPath, 'SOUL.md')).isFile()).toBe(true)
    expect(lstatSync(path.join(agentPath, 'USER.md')).isFile()).toBe(true)
  })

  it('removes only the requested managed storage subtree', async () => {
    const systemRoot = path.join(agentsDataRoot, 'system')
    const target = path.join(systemRoot, '2026-09-16', 'session-target')
    const sibling = path.join(systemRoot, '2026-09-16', 'session-sibling')
    await mkdir(target, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(path.join(target, 'agent-output.md'), 'target')
    await writeFile(path.join(sibling, 'agent-output.md'), 'sibling')

    await removeAgentStorageSubdirectory(systemRoot, target)

    expect(existsSync(target)).toBe(false)
    expect(await readFile(path.join(sibling, 'agent-output.md'), 'utf-8')).toBe('sibling')
  })

  it('treats a missing managed storage subtree as already removed', async () => {
    const systemRoot = path.join(agentsDataRoot, 'missing-system')
    const target = path.join(systemRoot, '2026-09-16', 'session-never-started')

    await expect(removeAgentStorageSubdirectory(systemRoot, target)).resolves.toBeUndefined()
  })

  it('refuses to remove the managed storage root itself', async () => {
    const systemRoot = path.join(agentsDataRoot, 'system')
    await mkdir(systemRoot)

    await expect(removeAgentStorageSubdirectory(systemRoot, systemRoot)).rejects.toThrow(
      /storage root or an outside path/
    )
    expect(existsSync(systemRoot)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('rejects an existing symlink target', async () => {
    const outside = path.join(agentsDataRoot, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(agentsDataRoot, AGENT_ID), 'dir')

    await expect(createAgentDataDirectory(agentsDataRoot, AGENT_ID)).rejects.toThrow(/symbolic link|already exists/)
  })

  it('rejects a symlinked or junction-backed managed root', async () => {
    const managedRoot = agentsDataRoot
    const outsideRoot = `${managedRoot}-outside`
    await mkdir(outsideRoot)
    await rm(managedRoot, { recursive: true })
    await symlink(outsideRoot, managedRoot, process.platform === 'win32' ? 'junction' : 'dir')

    try {
      await expect(createAgentDataDirectory(managedRoot, AGENT_ID)).rejects.toThrow(/storage root|symbolic link/i)
    } finally {
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  describe('assertAgentStorageDirectory', () => {
    it('accepts a real directory inside the root', async () => {
      const agentPath = path.join(agentsDataRoot, AGENT_ID)
      await mkdir(agentPath)

      await expect(assertAgentStorageDirectory(agentsDataRoot, agentPath)).resolves.toBeUndefined()
    })

    it('rejects a regular file at the target path', async () => {
      const filePath = path.join(agentsDataRoot, AGENT_ID)
      await writeFile(filePath, 'not a workspace')

      // assertAgentStoragePath only validates parents + containment, so a
      // regular file at the target passes it.
      await expect(assertAgentStorageDirectory(agentsDataRoot, filePath)).rejects.toThrow(/must be a real directory/)
    })

    it('rejects a missing target path', async () => {
      const agentPath = path.join(agentsDataRoot, AGENT_ID)

      await expect(assertAgentStorageDirectory(agentsDataRoot, agentPath)).rejects.toThrow()
    })
  })
})
