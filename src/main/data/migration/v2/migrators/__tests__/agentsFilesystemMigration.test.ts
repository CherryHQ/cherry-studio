import type * as FsPromises from 'node:fs/promises'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type AgentFileSessionPlan,
  copyLegacyClaudeConfig,
  isManagedLegacyAgentWorkspace,
  legacyAgentWorkspacePath,
  stageLegacyAgentFiles
} from '../agentsFilesystemMigration'

const copyMutation = vi.hoisted(() => ({
  afterCopy: undefined as undefined | ((sourcePath: string) => Promise<void>),
  beforeRealpath: undefined as undefined | ((sourcePath: string) => Promise<void>)
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>()
  return {
    ...original,
    cp: async (...args: Parameters<typeof original.cp>) => {
      await original.cp(...args)
      await copyMutation.afterCopy?.(String(args[0]))
    },
    realpath: async (...args: Parameters<typeof original.realpath>) => {
      await copyMutation.beforeRealpath?.(String(args[0]))
      return original.realpath(...args)
    }
  }
})

const SOURCE_AGENT_ID = 'agent_1234567890_keykxlx33'
const FINAL_AGENT_ID = '5f83c9de-f186-5d86-813f-1a19f190c68c'
const FINAL_OLD_SESSION_ID = '9a075ce3-c42d-545b-a0b5-f39e43e4a917'
const FINAL_LATEST_SESSION_ID = '01257168-34a7-5ff9-994d-bf78596c777c'

function buildSystemWorkspacePath(systemWorkspacesRoot: string, sessionId: string, createdAt: number): string {
  return path.join(systemWorkspacesRoot, new Date(createdAt).toISOString().slice(0, 10), sessionId)
}

describe('agentsFilesystemMigration', () => {
  const tempRoots: string[] = []

  async function createFixture() {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-filesystem-migration-'))
    tempRoots.push(tempRoot)
    const agentsDataRoot = path.join(tempRoot, 'Data', 'Agents')
    await mkdir(agentsDataRoot, { recursive: true })
    return {
      tempRoot,
      agentsDataRoot,
      legacyWorkspace: legacyAgentWorkspacePath(agentsDataRoot, SOURCE_AGENT_ID)
    }
  }

  function sessionPlan(
    agentsDataRoot: string,
    legacyWorkspace: string,
    input: {
      sourceSessionId: string
      finalSessionId: string
      createdAt: number
      updatedAt: number
      managed?: boolean
    }
  ): AgentFileSessionPlan {
    const managed = input.managed ?? true
    return {
      sourceSessionId: input.sourceSessionId,
      finalSessionId: input.finalSessionId,
      sourceAgentId: SOURCE_AGENT_ID,
      finalAgentId: FINAL_AGENT_ID,
      sourceWorkspacePath: legacyWorkspace,
      isManagedDefault: managed,
      systemWorkspacePath: managed
        ? buildSystemWorkspacePath(path.join(agentsDataRoot, 'system'), input.finalSessionId, input.createdAt)
        : undefined,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    }
  }

  afterEach(async () => {
    copyMutation.afterCopy = undefined
    copyMutation.beforeRealpath = undefined
    await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true, force: true })))
  })

  it('copies the legacy Claude config recursively and preserves the source', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    await mkdir(path.join(source, 'plugins'), { recursive: true })
    await writeFile(path.join(source, 'settings.json'), '{"theme":"dark"}')
    await writeFile(path.join(source, 'plugins', 'installed.json'), '{"version":1}')

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(true)

    expect(await readFile(path.join(destination, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(await readFile(path.join(destination, 'plugins', 'installed.json'), 'utf8')).toBe('{"version":1}')
    expect(await readFile(path.join(source, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(await readFile(path.join(source, 'plugins', 'installed.json'), 'utf8')).toBe('{"version":1}')
  })

  it('skips symlinks while copying the legacy Claude config', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    await mkdir(path.join(source, 'plugins'), { recursive: true })
    await writeFile(path.join(source, 'settings.json'), '{"theme":"dark"}')
    await writeFile(path.join(source, 'plugins', 'installed.json'), '{"version":1}')
    await symlink(
      process.platform === 'win32' ? path.join(source, 'plugins') : 'plugins',
      path.join(source, 'plugins-link'),
      process.platform === 'win32' ? 'junction' : undefined
    )
    if (process.platform !== 'win32') {
      await symlink('settings.json', path.join(source, 'settings-link.json'))
      await symlink('missing.json', path.join(source, 'dangling-link.json'))
    }

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(true)

    expect(await readFile(path.join(destination, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(await readFile(path.join(destination, 'plugins', 'installed.json'), 'utf8')).toBe('{"version":1}')
    await expect(lstat(path.join(destination, 'plugins-link'))).rejects.toThrow()
    if (process.platform !== 'win32') {
      await expect(lstat(path.join(destination, 'settings-link.json'))).rejects.toThrow()
      await expect(lstat(path.join(destination, 'dangling-link.json'))).rejects.toThrow()
    }

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(true)
  })

  it('reuses an identical Claude config destination on retry', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    await mkdir(source)
    await writeFile(path.join(source, 'settings.json'), '{"theme":"dark"}')

    await copyLegacyClaudeConfig(source, destination)

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(true)
    expect(await readFile(path.join(destination, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
  })

  it('rejects a conflicting Claude config destination without overwriting either side', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    await mkdir(source)
    await mkdir(destination)
    await writeFile(path.join(source, 'settings.json'), '{"source":true}')
    await writeFile(path.join(destination, 'settings.json'), '{"destination":true}')

    await expect(copyLegacyClaudeConfig(source, destination)).rejects.toThrow('destination conflict')

    expect(await readFile(path.join(source, 'settings.json'), 'utf8')).toBe('{"source":true}')
    expect(await readFile(path.join(destination, 'settings.json'), 'utf8')).toBe('{"destination":true}')
  })

  it.runIf(process.platform !== 'win32')(
    'splits identity from workspace content, materializes internal identity links, and preserves ordinary links',
    async () => {
      const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
      await mkdir(path.join(legacyWorkspace, 'memory'), { recursive: true })
      await writeFile(path.join(legacyWorkspace, 'identity-source.md'), 'agent soul')
      await symlink('identity-source.md', path.join(legacyWorkspace, 'SOUL.md'))
      await writeFile(path.join(legacyWorkspace, 'USER.md'), 'agent user')
      await symlink('SOUL.md', path.join(legacyWorkspace, 'soul-link'))
      await symlink(path.join(legacyWorkspace, 'USER.md'), path.join(legacyWorkspace, 'absolute-user-link'))
      await writeFile(path.join(legacyWorkspace, 'fact-source.md'), 'remember this')
      await symlink('../fact-source.md', path.join(legacyWorkspace, 'memory', 'FACT.md'))
      await symlink('memory/FACT.md', path.join(legacyWorkspace, 'memory-link'))
      await writeFile(path.join(legacyWorkspace, 'ordinary.txt'), 'workspace content')
      await symlink('ordinary.txt', path.join(legacyWorkspace, 'relative-link'))
      const sharedTarget = path.join(agentsDataRoot, 'shared', 'target.txt')
      await mkdir(path.dirname(sharedTarget), { recursive: true })
      await writeFile(sharedTarget, 'shared target')
      await symlink('../shared/target.txt', path.join(legacyWorkspace, 'external-relative-link'))
      await mkdir(path.join(legacyWorkspace, 'nested'))
      await symlink('../../shared/target.txt', path.join(legacyWorkspace, 'nested', 'external-relative-link'))
      const absoluteTarget = path.join(tempRoot, 'absolute-target.txt')
      await writeFile(absoluteTarget, 'external target')
      await symlink(absoluteTarget, path.join(legacyWorkspace, 'absolute-link'))
      await symlink('missing-target', path.join(legacyWorkspace, 'dangling-link'))

      const oldSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
        sourceSessionId: 'session_old',
        finalSessionId: FINAL_OLD_SESSION_ID,
        createdAt: Date.parse('2026-07-20T00:00:00Z'),
        updatedAt: Date.parse('2026-07-21T00:00:00Z')
      })
      const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
        sourceSessionId: 'session_latest',
        finalSessionId: FINAL_LATEST_SESSION_ID,
        createdAt: Date.parse('2026-07-22T00:00:00Z'),
        updatedAt: Date.parse('2026-07-23T00:00:00Z')
      })

      const input = {
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [oldSession, latestSession]
      }
      await stageLegacyAgentFiles(input)

      const agentDataPath = path.join(agentsDataRoot, FINAL_AGENT_ID)
      expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('agent soul')
      expect((await lstat(path.join(agentDataPath, 'SOUL.md'))).isSymbolicLink()).toBe(false)
      expect(await readFile(path.join(agentDataPath, 'USER.md'), 'utf8')).toBe('agent user')
      expect(await readFile(path.join(agentDataPath, 'memory', 'FACT.md'), 'utf8')).toBe('remember this')
      expect((await lstat(path.join(agentDataPath, 'memory', 'FACT.md'))).isSymbolicLink()).toBe(false)

      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe(
        'workspace content'
      )
      expect(await readlink(path.join(latestSession.systemWorkspacePath!, 'relative-link'))).toBe('ordinary.txt')
      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'external-relative-link'), 'utf8')).toBe(
        'shared target'
      )
      expect(
        await readFile(path.join(latestSession.systemWorkspacePath!, 'nested', 'external-relative-link'), 'utf8')
      ).toBe('shared target')
      expect(await readlink(path.join(latestSession.systemWorkspacePath!, 'absolute-link'))).toBe(absoluteTarget)
      expect(await readlink(path.join(latestSession.systemWorkspacePath!, 'dangling-link'))).toBe('missing-target')
      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'soul-link'), 'utf8')).toBe('agent soul')
      expect(await readlink(path.join(latestSession.systemWorkspacePath!, 'absolute-user-link'))).toBe(
        path.join(agentDataPath, 'USER.md')
      )
      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'memory-link'), 'utf8')).toBe('remember this')
      expect((await lstat(oldSession.systemWorkspacePath!)).isDirectory()).toBe(true)
      await expect(access(path.join(oldSession.systemWorkspacePath!, 'ordinary.txt'))).rejects.toThrow()

      // The complete v1 workspace remains available for downgrade compatibility
      // even after the v2 destinations have been verified and published.
      expect(await readFile(path.join(legacyWorkspace, 'SOUL.md'), 'utf8')).toBe('agent soul')
      expect((await lstat(path.join(legacyWorkspace, 'SOUL.md'))).isSymbolicLink()).toBe(true)
      expect(await readFile(path.join(legacyWorkspace, 'USER.md'), 'utf8')).toBe('agent user')
      expect(await readFile(path.join(legacyWorkspace, 'memory', 'FACT.md'), 'utf8')).toBe('remember this')
      expect(await readFile(path.join(legacyWorkspace, 'ordinary.txt'), 'utf8')).toBe('workspace content')

      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'soul-link'), 'utf8')).toBe('agent soul')
      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'absolute-user-link'), 'utf8')).toBe(
        'agent user'
      )
      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'memory-link'), 'utf8')).toBe('remember this')
      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'external-relative-link'), 'utf8')).toBe(
        'shared target'
      )

      // Stable remapped IDs make a retry converge on the same destinations.
      await expect(stageLegacyAgentFiles(input)).resolves.toBeUndefined()
      expect(await readFile(path.join(legacyWorkspace, 'ordinary.txt'), 'utf8')).toBe('workspace content')
      expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe(
        'workspace content'
      )
    }
  )

  it('keeps the newest identity entry when first-migration sources differ', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const olderWorkspace = path.join(tempRoot, 'older-workspace')
    const newestWorkspace = path.join(tempRoot, 'newest-workspace')
    await mkdir(olderWorkspace, { recursive: true })
    await mkdir(newestWorkspace, { recursive: true })
    await writeFile(path.join(olderWorkspace, 'SOUL.md'), 'older soul')
    await writeFile(path.join(newestWorkspace, 'SOUL.md'), 'newest soul')

    const olderSession = sessionPlan(agentsDataRoot, olderWorkspace, {
      sourceSessionId: 'session_old',
      finalSessionId: FINAL_OLD_SESSION_ID,
      createdAt: Date.parse('2026-07-20T00:00:00Z'),
      updatedAt: Date.parse('2026-07-21T00:00:00Z'),
      managed: false
    })
    const newestSession = sessionPlan(agentsDataRoot, newestWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [olderSession, newestSession]
    })

    expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'SOUL.md'), 'utf8')).toBe('newest soul')
    expect(await readFile(path.join(newestWorkspace, 'SOUL.md'), 'utf8')).toBe('newest soul')
    expect(await readFile(path.join(olderWorkspace, 'SOUL.md'), 'utf8')).toBe('older soul')
  })

  it('fills identity entries missing from the newest source using the next source', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const olderWorkspace = path.join(tempRoot, 'older-workspace')
    const newestWorkspace = path.join(tempRoot, 'newest-workspace')
    await mkdir(path.join(olderWorkspace, 'memory'), { recursive: true })
    await mkdir(newestWorkspace, { recursive: true })
    await writeFile(path.join(newestWorkspace, 'SOUL.md'), 'newest soul')
    await writeFile(path.join(olderWorkspace, 'USER.md'), 'fallback user')
    await writeFile(path.join(olderWorkspace, 'memory', 'FACT.md'), 'fallback fact')

    const olderSession = sessionPlan(agentsDataRoot, olderWorkspace, {
      sourceSessionId: 'session_old',
      finalSessionId: FINAL_OLD_SESSION_ID,
      createdAt: Date.parse('2026-07-20T00:00:00Z'),
      updatedAt: Date.parse('2026-07-21T00:00:00Z'),
      managed: false
    })
    const newestSession = sessionPlan(agentsDataRoot, newestWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [olderSession, newestSession]
    })

    const agentDataPath = path.join(agentsDataRoot, FINAL_AGENT_ID)
    expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('newest soul')
    expect(await readFile(path.join(agentDataPath, 'USER.md'), 'utf8')).toBe('fallback user')
    expect(await readFile(path.join(agentDataPath, 'memory', 'FACT.md'), 'utf8')).toBe('fallback fact')
  })

  it.runIf(process.platform !== 'win32')(
    'aborts instead of falling back when identity changes after its snapshot',
    async () => {
      const { tempRoot, agentsDataRoot } = await createFixture()
      const olderWorkspace = path.join(tempRoot, 'older-workspace')
      const newestWorkspace = path.join(tempRoot, 'newest-workspace')
      const newestIdentitySource = path.join(newestWorkspace, 'identity-source.md')
      const newestSoulPath = path.join(newestWorkspace, 'SOUL.md')
      const olderSoulPath = path.join(olderWorkspace, 'SOUL.md')
      await mkdir(olderWorkspace, { recursive: true })
      await mkdir(newestWorkspace, { recursive: true })
      await writeFile(newestIdentitySource, 'newest soul')
      await symlink('identity-source.md', newestSoulPath)
      await writeFile(olderSoulPath, 'older soul')

      let newestSoulRealpathCalls = 0
      copyMutation.beforeRealpath = async (sourcePath) => {
        if (sourcePath !== newestSoulPath || ++newestSoulRealpathCalls !== 2) return
        await rm(newestSoulPath)
        await symlink('missing-source.md', newestSoulPath)
      }

      const olderSession = sessionPlan(agentsDataRoot, olderWorkspace, {
        sourceSessionId: 'session_old',
        finalSessionId: FINAL_OLD_SESSION_ID,
        createdAt: Date.parse('2026-07-20T00:00:00Z'),
        updatedAt: Date.parse('2026-07-21T00:00:00Z'),
        managed: false
      })
      const newestSession = sessionPlan(agentsDataRoot, newestWorkspace, {
        sourceSessionId: 'session_latest',
        finalSessionId: FINAL_LATEST_SESSION_ID,
        createdAt: Date.parse('2026-07-22T00:00:00Z'),
        updatedAt: Date.parse('2026-07-23T00:00:00Z'),
        managed: false
      })

      await expect(
        stageLegacyAgentFiles({
          agentsDataRoot,
          agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
          sessions: [olderSession, newestSession]
        })
      ).rejects.toThrow(/identity changed while being copied/i)

      const agentDataPath = path.join(agentsDataRoot, FINAL_AGENT_ID)
      await expect(access(path.join(agentDataPath, 'SOUL.md'))).rejects.toThrow()
      expect((await readdir(agentDataPath)).every((entry) => !entry.startsWith('.SOUL.md.migration-'))).toBe(true)
      expect(await readlink(newestSoulPath)).toBe('missing-source.md')
      expect(await readFile(newestIdentitySource, 'utf8')).toBe('newest soul')
      expect(await readFile(olderSoulPath, 'utf8')).toBe('older soul')
    }
  )

  it('aborts on an identity conflict without overwriting either side', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'legacy soul')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    const agentDataPath = path.join(agentsDataRoot, FINAL_AGENT_ID)
    await mkdir(path.join(agentDataPath, 'memory'), { recursive: true })
    await writeFile(path.join(agentDataPath, 'SOUL.md'), 'existing soul')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).rejects.toThrow(/identity destination conflict/i)

    expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('existing soul')
    expect(await readFile(path.join(legacyWorkspace, 'SOUL.md'), 'utf8')).toBe('legacy soul')
  })

  it('reuses identical identity but aborts when the v1 identity changes before a retry', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    await mkdir(path.join(legacyWorkspace, 'memory'), { recursive: true })
    await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'first soul')
    await writeFile(path.join(legacyWorkspace, 'memory', 'FACT.md'), 'first fact')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    const input = {
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [latestSession]
    }

    await stageLegacyAgentFiles(input)
    await expect(stageLegacyAgentFiles(input)).resolves.toBeUndefined()

    await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'newer soul')
    await writeFile(path.join(legacyWorkspace, 'memory', 'FACT.md'), 'newer fact')
    await expect(stageLegacyAgentFiles(input)).rejects.toThrow(/identity destination conflict/i)

    expect(await readFile(path.join(legacyWorkspace, 'SOUL.md'), 'utf8')).toBe('newer soul')
    expect(await readFile(path.join(legacyWorkspace, 'memory', 'FACT.md'), 'utf8')).toBe('newer fact')
    expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'SOUL.md'), 'utf8')).toBe('first soul')
    expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'memory', 'FACT.md'), 'utf8')).toBe('first fact')
  })

  it('aborts on an ordinary workspace conflict without overwriting either side', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(path.join(legacyWorkspace, 'conflict.txt'), 'legacy workspace value')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    await mkdir(latestSession.systemWorkspacePath!, { recursive: true })
    await writeFile(path.join(latestSession.systemWorkspacePath!, 'conflict.txt'), 'existing workspace value')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).rejects.toThrow(/conflict/i)

    expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'conflict.txt'), 'utf8')).toBe(
      'existing workspace value'
    )
    expect(await readFile(path.join(legacyWorkspace, 'conflict.txt'), 'utf8')).toBe('legacy workspace value')
    expect(
      (await readdir(path.dirname(latestSession.systemWorkspacePath!))).every(
        (entry) => !entry.startsWith(`.${FINAL_LATEST_SESSION_ID}.migration-`)
      )
    ).toBe(true)
  })

  it('rejects a partial directory destination and removes retry staging data', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourceBundle = path.join(legacyWorkspace, 'bundle')
    await mkdir(sourceBundle, { recursive: true })
    await writeFile(path.join(sourceBundle, 'first.txt'), 'first')
    await writeFile(path.join(sourceBundle, 'second.txt'), 'second')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    const destinationBundle = path.join(latestSession.systemWorkspacePath!, 'bundle')
    await mkdir(destinationBundle, { recursive: true })
    await writeFile(path.join(destinationBundle, 'first.txt'), 'first')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).rejects.toThrow(/conflict/i)

    expect(await readFile(path.join(sourceBundle, 'second.txt'), 'utf8')).toBe('second')
    await expect(access(path.join(destinationBundle, 'second.txt'))).rejects.toThrow()
    expect(
      (await readdir(path.dirname(latestSession.systemWorkspacePath!))).every(
        (entry) => !entry.startsWith(`.${FINAL_LATEST_SESSION_ID}.migration-`)
      )
    ).toBe(true)
  })

  it('does not delete unrelated staging-shaped entries from the managed destination root', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(path.join(legacyWorkspace, 'ordinary.txt'), 'workspace content')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    const stagingParent = path.dirname(latestSession.systemWorkspacePath!)
    const unrelatedPath = path.join(stagingParent, `.${FINAL_LATEST_SESSION_ID}.migration-user-data`)
    await mkdir(unrelatedPath, { recursive: true })
    await writeFile(path.join(unrelatedPath, 'keep.txt'), 'keep me')

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [latestSession]
    })

    expect(await readFile(path.join(unrelatedPath, 'keep.txt'), 'utf8')).toBe('keep me')
  })

  it('accepts an identical completed destination when retrying and keeps the v1 source', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(path.join(legacyWorkspace, 'completed.txt'), 'copied value')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    await mkdir(latestSession.systemWorkspacePath!, { recursive: true })
    await writeFile(path.join(latestSession.systemWorkspacePath!, 'completed.txt'), 'copied value')

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [latestSession]
    })

    expect(await readFile(path.join(legacyWorkspace, 'completed.txt'), 'utf8')).toBe('copied value')
    expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'completed.txt'), 'utf8')).toBe('copied value')
  })

  it('aborts before publishing when a source changes during the copy window', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourcePath = path.join(legacyWorkspace, 'race.txt')
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(sourcePath, 'copied value')
    const originalStat = await stat(sourcePath)
    copyMutation.afterCopy = async (copiedSourcePath) => {
      if (copiedSourcePath !== sourcePath) return
      await writeFile(sourcePath, 'newest value')
      await utimes(sourcePath, originalStat.atime, originalStat.mtime)
    }
    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).rejects.toThrow(/changed while being copied/)

    expect(await readFile(sourcePath, 'utf8')).toBe('newest value')
    await expect(access(path.join(latestSession.systemWorkspacePath!, 'race.txt'))).rejects.toThrow()
  })

  it.runIf(process.platform !== 'win32')(
    'treats a symlinked v1 root as an external user workspace without following or deleting it',
    async () => {
      const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
      const externalWorkspace = path.join(tempRoot, 'external-workspace')
      await mkdir(externalWorkspace)
      await writeFile(path.join(externalWorkspace, 'SOUL.md'), 'external soul')
      await writeFile(path.join(externalWorkspace, 'ordinary.txt'), 'external ordinary')
      await symlink(externalWorkspace, legacyWorkspace)

      expect(await isManagedLegacyAgentWorkspace(agentsDataRoot, SOURCE_AGENT_ID, legacyWorkspace)).toBe(false)

      await stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [
          sessionPlan(agentsDataRoot, legacyWorkspace, {
            sourceSessionId: 'session_external',
            finalSessionId: FINAL_LATEST_SESSION_ID,
            createdAt: Date.parse('2026-07-22T00:00:00Z'),
            updatedAt: Date.parse('2026-07-23T00:00:00Z'),
            managed: false
          })
        ]
      })

      expect((await lstat(legacyWorkspace)).isSymbolicLink()).toBe(true)
      expect(await readFile(path.join(externalWorkspace, 'SOUL.md'), 'utf8')).toBe('external soul')
      expect(await readFile(path.join(externalWorkspace, 'ordinary.txt'), 'utf8')).toBe('external ordinary')
      expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'SOUL.md'), 'utf8')).toBe('external soul')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'does not follow external, dangling, or cyclic identity links from a user workspace',
    async () => {
      const { tempRoot, agentsDataRoot } = await createFixture()
      const userWorkspace = path.join(tempRoot, 'user-workspace')
      const externalFile = path.join(tempRoot, 'external-soul.md')
      await mkdir(userWorkspace)
      await writeFile(externalFile, 'must not copy')
      await symlink(externalFile, path.join(userWorkspace, 'SOUL.md'))
      await symlink('missing-user.md', path.join(userWorkspace, 'USER.md'))
      await symlink('cycle-b', path.join(userWorkspace, 'cycle-a'))
      await symlink('cycle-a', path.join(userWorkspace, 'cycle-b'))
      await symlink('cycle-a', path.join(userWorkspace, 'memory'))

      await stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [
          {
            ...sessionPlan(agentsDataRoot, userWorkspace, {
              sourceSessionId: 'session_user',
              finalSessionId: FINAL_LATEST_SESSION_ID,
              createdAt: Date.parse('2026-07-22T00:00:00Z'),
              updatedAt: Date.parse('2026-07-23T00:00:00Z'),
              managed: false
            }),
            sourceWorkspacePath: userWorkspace
          }
        ]
      })

      const agentDataPath = path.join(agentsDataRoot, FINAL_AGENT_ID)
      expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('')
      expect(await readFile(path.join(agentDataPath, 'USER.md'), 'utf8')).toBe('')
      expect((await lstat(path.join(agentDataPath, 'memory'))).isDirectory()).toBe(true)
      expect((await lstat(path.join(userWorkspace, 'SOUL.md'))).isSymbolicLink()).toBe(true)
      expect((await lstat(path.join(userWorkspace, 'USER.md'))).isSymbolicLink()).toBe(true)
      expect((await lstat(path.join(userWorkspace, 'memory'))).isSymbolicLink()).toBe(true)
    }
  )

  it('copies identity without moving any content from an external user workspace', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const userWorkspace = path.join(tempRoot, 'user-workspace')
    await mkdir(userWorkspace)
    await writeFile(path.join(userWorkspace, 'SOUL.md'), 'external user identity')
    await writeFile(path.join(userWorkspace, 'ordinary.txt'), 'external project content')

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [
        {
          ...sessionPlan(agentsDataRoot, userWorkspace, {
            sourceSessionId: 'session_user',
            finalSessionId: FINAL_LATEST_SESSION_ID,
            createdAt: Date.parse('2026-07-22T00:00:00Z'),
            updatedAt: Date.parse('2026-07-23T00:00:00Z'),
            managed: false
          }),
          sourceWorkspacePath: userWorkspace
        }
      ]
    })

    expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'SOUL.md'), 'utf8')).toBe('external user identity')
    expect(await readFile(path.join(userWorkspace, 'SOUL.md'), 'utf8')).toBe('external user identity')
    expect(await readFile(path.join(userWorkspace, 'ordinary.txt'), 'utf8')).toBe('external project content')
  })

  it('keeps ordinary v1 content in place when the agent has no sessions', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'agent soul')
    await writeFile(path.join(legacyWorkspace, 'ordinary.txt'), 'keep me')

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: []
    })

    expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'SOUL.md'), 'utf8')).toBe('agent soul')
    expect(await readFile(path.join(legacyWorkspace, 'ordinary.txt'), 'utf8')).toBe('keep me')
    await expect(access(path.join(agentsDataRoot, 'system'))).rejects.toThrow()
  })
})
