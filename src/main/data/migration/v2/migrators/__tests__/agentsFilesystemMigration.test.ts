import type * as FsPromises from 'node:fs/promises'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type * as Platform from '@main/core/platform'
import PQueue from 'p-queue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type AgentFileSessionPlan,
  type ClaudeConfigMigrationProgress,
  claudeProjectDirectoryName,
  copyLegacyClaudeConfig,
  copyLegacyClaudeSessionData,
  isManagedLegacyAgentWorkspace,
  legacyAgentWorkspacePath,
  stageLegacyAgentFiles
} from '../agentsFilesystemMigration'

const { copyMutation, platformState } = vi.hoisted(() => ({
  copyMutation: {
    afterCopyFile: undefined as undefined | ((sourcePath: string, destinationPath: string) => Promise<void>),
    beforeRealpath: undefined as undefined | ((sourcePath: string) => Promise<void>),
    beforeSymlink: undefined as undefined | ((target: string, path: string, type?: string | null) => Promise<void>),
    copyFileCalls: [] as Array<[sourcePath: string, destinationPath: string]>,
    symlinkCalls: [] as Array<[target: string, path: string, type?: string | null]>
  },
  platformState: { isMac: false, isWin: false }
}))

vi.mock('@main/core/platform', async (importOriginal) => {
  const original = await importOriginal<typeof Platform>()
  return {
    ...original,
    get isMac() {
      return platformState.isMac
    },
    get isWin() {
      return platformState.isWin
    }
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>()
  return {
    ...original,
    cp: async (...args: Parameters<typeof original.cp>) => {
      const [source, destination, options] = args
      await original.cp(source, destination, {
        ...options,
        filter: async (sourcePath, destinationPath) => {
          const included = (await options?.filter?.(sourcePath, destinationPath)) ?? true
          if (included && platformState.isWin && (await original.lstat(sourcePath)).isSymbolicLink()) {
            const error = new Error(`operation not permitted, symlink '${sourcePath}' -> '${destinationPath}'`)
            Object.assign(error, { code: 'EPERM', syscall: 'symlink' })
            throw error
          }
          return included
        }
      })
    },
    copyFile: async (...args: Parameters<typeof original.copyFile>) => {
      copyMutation.copyFileCalls.push([String(args[0]), String(args[1])])
      const result = await original.copyFile(...args)
      await copyMutation.afterCopyFile?.(String(args[0]), String(args[1]))
      return result
    },
    realpath: async (...args: Parameters<typeof original.realpath>) => {
      await copyMutation.beforeRealpath?.(String(args[0]))
      return original.realpath(...args)
    },
    symlink: async (...args: Parameters<typeof original.symlink>) => {
      copyMutation.symlinkCalls.push([String(args[0]), String(args[1]), args[2]])
      await copyMutation.beforeSymlink?.(String(args[0]), String(args[1]), args[2])
      return original.symlink(...args)
    }
  }
})

const SOURCE_AGENT_ID = 'agent_1234567890_keykxlx33'
const FINAL_AGENT_ID = '5f83c9de-f186-5d86-813f-1a19f190c68c'
const FINAL_OLD_SESSION_ID = '9a075ce3-c42d-545b-a0b5-f39e43e4a917'
const FINAL_LATEST_SESSION_ID = '01257168-34a7-5ff9-994d-bf78596c777c'
const CLAUDE_SESSION_ID = '95b9a03b-6704-4a4b-bcf1-f65dabb67bf6'
const MISSING_LATEST_CLAUDE_SESSION_ID = '3f5221a6-b39d-4cab-a82d-7a7ed7ccf5db'

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
      latestRuntimeResumeToken?: string
      runtimeResumeTokens?: string[]
    }
  ): AgentFileSessionPlan {
    const managed = input.managed ?? true
    const runtimeResumeTokens = input.runtimeResumeTokens ?? []
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
      latestRuntimeResumeToken: input.latestRuntimeResumeToken ?? runtimeResumeTokens.at(-1),
      runtimeResumeTokens,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    }
  }

  afterEach(async () => {
    copyMutation.afterCopyFile = undefined
    copyMutation.beforeRealpath = undefined
    copyMutation.beforeSymlink = undefined
    copyMutation.copyFileCalls.length = 0
    copyMutation.symlinkCalls.length = 0
    platformState.isMac = false
    platformState.isWin = false
    await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true, force: true })))
  })

  it('copies the legacy Claude config recursively and preserves the source', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    await mkdir(path.join(source, 'plugins'), { recursive: true })
    await mkdir(path.join(source, 'projects', 'legacy-project'), { recursive: true })
    await writeFile(path.join(source, 'settings.json'), '{"theme":"dark"}')
    await writeFile(path.join(source, 'plugins', 'installed.json'), '{"version":1}')
    await writeFile(path.join(source, 'projects', 'legacy-project', 'session.jsonl'), '{"session":true}')

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(true)

    expect(await readFile(path.join(destination, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(await readFile(path.join(destination, 'plugins', 'installed.json'), 'utf8')).toBe('{"version":1}')
    expect(await readFile(path.join(destination, 'projects', 'legacy-project', 'session.jsonl'), 'utf8')).toBe(
      '{"session":true}'
    )
    expect(await readFile(path.join(source, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(await readFile(path.join(source, 'plugins', 'installed.json'), 'utf8')).toBe('{"version":1}')
    expect(await readFile(path.join(source, 'projects', 'legacy-project', 'session.jsonl'), 'utf8')).toBe(
      '{"session":true}'
    )
  })

  it('reports incremental scan, copy, and verification progress for a large Claude config', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    const contents = [
      Buffer.alloc(9 * 1024 * 1024, 0x61),
      Buffer.alloc(9 * 1024 * 1024, 0x62),
      Buffer.from('session transcript')
    ]
    await mkdir(path.join(source, 'plugins'), { recursive: true })
    await mkdir(path.join(source, 'projects', 'legacy-project'), { recursive: true })
    await writeFile(path.join(source, 'settings.json'), contents[0])
    await writeFile(path.join(source, 'plugins', 'installed.json'), contents[1])
    await writeFile(path.join(source, 'projects', 'legacy-project', 'session.jsonl'), contents[2])

    const progress: ClaudeConfigMigrationProgress[] = []
    await copyLegacyClaudeConfig(source, destination, (update) => progress.push(update))

    expect([...new Set(progress.map((update) => update.phase))]).toEqual(['scanning', 'copying', 'verifying'])
    const expectedBytes = contents.reduce((total, content) => total + content.byteLength, 0)
    for (const phase of ['scanning', 'copying', 'verifying'] as const) {
      const phaseProgress = progress.filter((update) => update.phase === phase)
      expect(phaseProgress.at(-1)).toEqual({
        phase,
        processed: contents.length,
        total: contents.length,
        byteCount: expectedBytes,
        byteTotal: expectedBytes
      })
      expect(
        phaseProgress.every(
          (update, index) =>
            index === 0 ||
            (update.processed >= phaseProgress[index - 1].processed &&
              update.byteCount >= phaseProgress[index - 1].byteCount)
        )
      ).toBe(true)
      expect(phaseProgress.some((update) => update.byteCount > 0 && update.byteCount < expectedBytes)).toBe(true)
    }
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

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(false)
  })

  it('skips an existing identical Claude config destination on retry', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    await mkdir(source)
    await writeFile(path.join(source, 'settings.json'), '{"theme":"dark"}')

    await copyLegacyClaudeConfig(source, destination)

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(false)
    expect(await readFile(path.join(destination, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
  })

  it('skips a conflicting Claude config destination without overwriting either side', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const source = path.join(tempRoot, '.claude')
    const destination = path.join(agentsDataRoot, '.claude')
    await mkdir(source)
    await mkdir(destination)
    await writeFile(path.join(source, 'settings.json'), '{"source":true}')
    await writeFile(path.join(destination, 'settings.json'), '{"destination":true}')

    await expect(copyLegacyClaudeConfig(source, destination)).resolves.toBe(false)

    expect(await readFile(path.join(source, 'settings.json'), 'utf8')).toBe('{"source":true}')
    expect(await readFile(path.join(destination, 'settings.json'), 'utf8')).toBe('{"destination":true}')
  })

  it('matches the Claude SDK project directory name for the observed legacy workspace', () => {
    expect(
      claudeProjectDirectoryName('/Users/suyao/Library/Application Support/CherryStudioDev/Data/Agents/cvqr0cflx')
    ).toBe('-Users-suyao-Library-Application-Support-CherryStudioDev-Data-Agents-cvqr0cflx')
  })

  it('uses the old cwd project before falling back to other Claude projects', async () => {
    const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
    const legacyProjectsDirectory = path.join(tempRoot, '.claude', 'projects')
    const destinationProjectsDirectory = path.join(agentsDataRoot, '.claude', 'projects')
    const expectedProjectDirectory = path.join(
      legacyProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(legacyWorkspace))
    )
    const unrelatedProjectDirectory = path.join(legacyProjectsDirectory, 'a-unrelated-project')
    await mkdir(expectedProjectDirectory, { recursive: true })
    await mkdir(unrelatedProjectDirectory, { recursive: true })
    await writeFile(path.join(expectedProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), '{"source":"expected"}\n')
    await writeFile(path.join(unrelatedProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), '{"source":"fallback"}\n')

    const session = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      runtimeResumeTokens: [CLAUDE_SESSION_ID]
    })

    await copyLegacyClaudeSessionData({
      agentsDataRoot,
      sourceProjectsDirectories: [legacyProjectsDirectory, destinationProjectsDirectory],
      destinationProjectsDirectory,
      sessions: [session]
    })
    const destinationProjectDirectory = path.join(
      destinationProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(session.systemWorkspacePath!))
    )
    expect(await readFile(path.join(destinationProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), 'utf8')).toBe(
      '{"source":"expected"}\n'
    )
  })

  it('makes an external workspace token available under its unchanged runtime cwd', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const externalWorkspace = path.join(tempRoot, 'external-workspace')
    const legacyProjectsDirectory = path.join(tempRoot, '.claude', 'projects')
    const destinationProjectsDirectory = path.join(agentsDataRoot, '.claude', 'projects')
    await mkdir(externalWorkspace)
    const sourceProjectDirectory = path.join(
      legacyProjectsDirectory,
      claudeProjectDirectoryName(await realpath(externalWorkspace))
    )
    await mkdir(sourceProjectDirectory, { recursive: true })
    await writeFile(path.join(sourceProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), '{"external":true}\n')

    const session = sessionPlan(agentsDataRoot, externalWorkspace, {
      sourceSessionId: 'session_external',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-01-01T00:00:00Z'),
      updatedAt: Date.parse('2026-01-02T00:00:00Z'),
      managed: false,
      runtimeResumeTokens: [CLAUDE_SESSION_ID]
    })

    await copyLegacyClaudeSessionData({
      agentsDataRoot,
      sourceProjectsDirectories: [legacyProjectsDirectory],
      destinationProjectsDirectory,
      sessions: [session]
    })

    const destinationProjectDirectory = path.join(
      destinationProjectsDirectory,
      claudeProjectDirectoryName(await realpath(externalWorkspace))
    )
    expect(await readFile(path.join(destinationProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), 'utf8')).toBe(
      '{"external":true}\n'
    )
  })

  it('replaces only the exact globally discovered Claude JSONL target', async () => {
    const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
    const legacyProjectsDirectory = path.join(tempRoot, '.claude', 'projects')
    const destinationProjectsDirectory = path.join(agentsDataRoot, '.claude', 'projects')
    const sourceProjectDirectory = path.join(legacyProjectsDirectory, 'workspace-key-from-before-the-rename')
    const sourceAuxiliaryDirectory = path.join(sourceProjectDirectory, CLAUDE_SESSION_ID, 'subagents')
    await mkdir(sourceAuxiliaryDirectory, { recursive: true })
    await writeFile(path.join(sourceProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), '{"type":"user"}\n')
    await writeFile(path.join(sourceAuxiliaryDirectory, 'agent-child.jsonl'), '{"type":"assistant"}\n')

    const session = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      runtimeResumeTokens: [CLAUDE_SESSION_ID]
    })
    const input = {
      agentsDataRoot,
      sourceProjectsDirectories: [legacyProjectsDirectory, destinationProjectsDirectory],
      destinationProjectsDirectory,
      sessions: [session]
    }

    await copyLegacyClaudeSessionData(input)

    const destinationProjectDirectory = path.join(
      destinationProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(session.systemWorkspacePath!))
    )
    const destinationTranscript = path.join(destinationProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`)
    expect(await readFile(destinationTranscript, 'utf8')).toBe('{"type":"user"}\n')
    await expect(access(path.join(destinationProjectDirectory, CLAUDE_SESSION_ID))).rejects.toThrow()
    expect(await readFile(path.join(sourceProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), 'utf8')).toBe(
      '{"type":"user"}\n'
    )
    expect(await readFile(path.join(sourceAuxiliaryDirectory, 'agent-child.jsonl'), 'utf8')).toBe(
      '{"type":"assistant"}\n'
    )

    const unrelatedDestination = path.join(destinationProjectDirectory, 'keep.jsonl')
    await writeFile(unrelatedDestination, '{"keep":true}\n')
    await writeFile(destinationTranscript, '{"type":"destination"}\n')
    await expect(copyLegacyClaudeSessionData(input)).resolves.toBeUndefined()

    expect(await readFile(destinationTranscript, 'utf8')).toBe('{"type":"user"}\n')
    expect(await readFile(unrelatedDestination, 'utf8')).toBe('{"keep":true}\n')
    expect(await readFile(path.join(sourceProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), 'utf8')).toBe(
      '{"type":"user"}\n'
    )
  })

  it('keeps a Claude session cache entry when it is also the only source', async () => {
    const { tempRoot, agentsDataRoot } = await createFixture()
    const externalWorkspace = path.join(tempRoot, 'external-workspace')
    const destinationProjectsDirectory = path.join(agentsDataRoot, '.claude', 'projects')
    const projectDirectory = path.join(
      destinationProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(externalWorkspace))
    )
    const transcriptPath = path.join(projectDirectory, `${CLAUDE_SESSION_ID}.jsonl`)
    await mkdir(externalWorkspace)
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(transcriptPath, '{"only":"source"}\n')

    const session = sessionPlan(agentsDataRoot, externalWorkspace, {
      sourceSessionId: 'session_external',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false,
      runtimeResumeTokens: [CLAUDE_SESSION_ID]
    })

    await copyLegacyClaudeSessionData({
      agentsDataRoot,
      sourceProjectsDirectories: [destinationProjectsDirectory],
      destinationProjectsDirectory,
      sessions: [session]
    })

    expect(await readFile(transcriptPath, 'utf8')).toBe('{"only":"source"}\n')
  })

  it('does not overwrite a Claude session cache target created after cleanup', async () => {
    const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
    const legacyProjectsDirectory = path.join(tempRoot, '.claude', 'projects')
    const destinationProjectsDirectory = path.join(agentsDataRoot, '.claude', 'projects')
    const sourceProjectDirectory = path.join(
      legacyProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(legacyWorkspace))
    )
    const sourceTranscript = path.join(sourceProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`)
    await mkdir(sourceProjectDirectory, { recursive: true })
    await writeFile(sourceTranscript, '{"source":true}\n')

    const session = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      runtimeResumeTokens: [CLAUDE_SESSION_ID]
    })
    const destinationTranscript = path.join(
      destinationProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(session.systemWorkspacePath!)),
      `${CLAUDE_SESSION_ID}.jsonl`
    )
    copyMutation.afterCopyFile = async (sourcePath) => {
      if (sourcePath !== sourceTranscript) return
      await writeFile(destinationTranscript, '{"concurrent":true}\n')
    }

    await expect(
      copyLegacyClaudeSessionData({
        agentsDataRoot,
        sourceProjectsDirectories: [legacyProjectsDirectory],
        destinationProjectsDirectory,
        sessions: [session]
      })
    ).rejects.toThrow(/Claude session cache destination conflict/)

    expect(await readFile(destinationTranscript, 'utf8')).toBe('{"concurrent":true}\n')
    expect(await readFile(sourceTranscript, 'utf8')).toBe('{"source":true}\n')
  })

  it('does not copy or expose an older Claude token when the latest token is missing', async () => {
    const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
    const legacyProjectsDirectory = path.join(tempRoot, '.claude', 'projects')
    const destinationProjectsDirectory = path.join(agentsDataRoot, '.claude', 'projects')
    const sourceProjectDirectory = path.join(
      legacyProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(legacyWorkspace))
    )
    await mkdir(sourceProjectDirectory, { recursive: true })
    await writeFile(path.join(sourceProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`), '{"source":"older"}\n')

    const session = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      latestRuntimeResumeToken: MISSING_LATEST_CLAUDE_SESSION_ID,
      runtimeResumeTokens: [CLAUDE_SESSION_ID, MISSING_LATEST_CLAUDE_SESSION_ID]
    })

    await copyLegacyClaudeSessionData({
      agentsDataRoot,
      sourceProjectsDirectories: [legacyProjectsDirectory],
      destinationProjectsDirectory,
      sessions: [session]
    })

    const destinationProjectDirectory = path.join(
      destinationProjectsDirectory,
      claudeProjectDirectoryName(path.resolve(session.systemWorkspacePath!))
    )
    await expect(access(path.join(destinationProjectDirectory, `${CLAUDE_SESSION_ID}.jsonl`))).rejects.toThrow()
  })

  it.runIf(process.platform !== 'win32')(
    'recreates copied directory links as Windows junctions without asking fs.cp to copy the link',
    async () => {
      const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
      const skillSource = path.join(tempRoot, 'Data', 'Skills', 'find-skills')
      const sourceLink = path.join(legacyWorkspace, 'skills', 'find-skills')
      await mkdir(skillSource, { recursive: true })
      await writeFile(path.join(skillSource, 'SKILL.md'), '# Find Skills')
      await mkdir(path.dirname(sourceLink), { recursive: true })
      await symlink(skillSource, sourceLink, 'dir')
      copyMutation.symlinkCalls.length = 0
      platformState.isWin = true

      const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
        sourceSessionId: 'session_latest',
        finalSessionId: FINAL_LATEST_SESSION_ID,
        createdAt: Date.parse('2026-07-22T00:00:00Z'),
        updatedAt: Date.parse('2026-07-23T00:00:00Z')
      })

      await stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })

      const destinationLink = path.join(latestSession.systemWorkspacePath!, 'skills', 'find-skills')
      expect(await readlink(destinationLink)).toBe(skillSource)
      expect(copyMutation.symlinkCalls).toContainEqual([
        skillSource,
        expect.stringMatching(/[\\/]\.01257168-34a7-5ff9-994d-bf78596c777c\.migration-[^\\/]+[\\/]find-skills$/),
        'junction'
      ])
    }
  )

  it.runIf(process.platform !== 'win32')(
    'falls back to a directory symlink when publishing a top-level Windows junction fails',
    async () => {
      const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
      const sharedDirectory = path.join(tempRoot, 'shared-directory')
      const sourceLink = path.join(legacyWorkspace, 'shared-directory')
      await mkdir(sharedDirectory, { recursive: true })
      await writeFile(path.join(sharedDirectory, 'shared.txt'), 'shared content')
      await mkdir(legacyWorkspace, { recursive: true })
      await symlink(sharedDirectory, sourceLink, 'dir')
      copyMutation.symlinkCalls.length = 0
      copyMutation.beforeSymlink = async (_target, _linkPath, type) => {
        if (type !== 'junction') return
        const error = new Error('junction target is not supported')
        Object.assign(error, { code: 'EPERM', syscall: 'symlink' })
        throw error
      }
      platformState.isWin = true

      const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
        sourceSessionId: 'session_latest',
        finalSessionId: FINAL_LATEST_SESSION_ID,
        createdAt: Date.parse('2026-07-22T00:00:00Z'),
        updatedAt: Date.parse('2026-07-23T00:00:00Z')
      })

      await stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })

      const destinationLink = path.join(latestSession.systemWorkspacePath!, 'shared-directory')
      const stagingLinkPattern = /[\\/]\.01257168-34a7-5ff9-994d-bf78596c777c\.migration-[^\\/]+$/
      expect(await readlink(destinationLink)).toBe(sharedDirectory)
      expect(copyMutation.symlinkCalls).toEqual(
        expect.arrayContaining([
          [sharedDirectory, expect.stringMatching(stagingLinkPattern), 'junction'],
          [sharedDirectory, expect.stringMatching(stagingLinkPattern), 'dir'],
          [sharedDirectory, destinationLink, 'junction'],
          [sharedDirectory, destinationLink, 'dir']
        ])
      )
    }
  )

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
      expect(await readFile(path.join(oldSession.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe(
        'workspace content'
      )

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

  it('copies ordinary output for every managed session without an age limit', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(path.join(legacyWorkspace, 'ordinary.txt'), 'workspace content')

    const oldSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_old',
      finalSessionId: FINAL_OLD_SESSION_ID,
      createdAt: Date.parse('2026-05-01T00:00:00Z'),
      updatedAt: Date.parse('2026-05-02T00:00:00Z')
    })
    const recentSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [oldSession, recentSession]
    })

    expect((await lstat(oldSession.systemWorkspacePath!)).isDirectory()).toBe(true)
    expect(await readFile(path.join(oldSession.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe('workspace content')
    expect(await readFile(path.join(recentSession.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe(
      'workspace content'
    )
  })

  it('reuses the first verified private copy for every later managed session', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourceFile = path.join(legacyWorkspace, 'ordinary.txt')
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(sourceFile, 'workspace content')

    const oldSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_old',
      finalSessionId: FINAL_OLD_SESSION_ID,
      createdAt: Date.parse('2026-05-01T00:00:00Z'),
      updatedAt: Date.parse('2026-05-02T00:00:00Z')
    })
    const recentSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [oldSession, recentSession]
    })

    expect(copyMutation.copyFileCalls.filter(([sourcePath]) => sourcePath === sourceFile)).toHaveLength(1)
    expect(await readFile(path.join(oldSession.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe('workspace content')
    expect(await readFile(path.join(recentSession.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe(
      'workspace content'
    )
  })

  it('bounds and continuously refills filesystem work for a high-fan-out workspace', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourceBundle = path.join(legacyWorkspace, 'bundle', 'nested')
    const fileCount = 64
    await mkdir(sourceBundle, { recursive: true })
    await Promise.all(
      Array.from({ length: fileCount }, (_, index) =>
        writeFile(path.join(sourceBundle, `file-${index.toString().padStart(3, '0')}.txt`), `content ${index}`)
      )
    )

    const session = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    const originalAdd = PQueue.prototype.add
    let maxRunning = 0
    let maxOutstanding = 0
    const trackedAdd = function (this: PQueue, ...args: Parameters<PQueue['add']>): ReturnType<PQueue['add']> {
      const result = originalAdd.apply(this, args)
      maxRunning = Math.max(maxRunning, this.pending)
      maxOutstanding = Math.max(maxOutstanding, this.pending + this.size)
      return result
    }
    const addSpy = vi.spyOn(PQueue.prototype, 'add').mockImplementation(trackedAdd as PQueue['add'])
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    copyMutation.afterCopyFile = async (sourcePath) => {
      if (sourcePath.endsWith('file-000.txt')) await firstBlocked
    }

    try {
      const migration = stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [session]
      })
      try {
        await vi.waitFor(() => {
          expect(copyMutation.copyFileCalls.some(([source]) => source.endsWith('file-016.txt'))).toBe(true)
        })
      } finally {
        releaseFirst()
        await migration
      }
    } finally {
      addSpy.mockRestore()
    }

    expect(maxRunning).toBeGreaterThan(1)
    expect(maxOutstanding).toBeLessThanOrEqual(16)
    expect(await readdir(path.join(session.systemWorkspacePath!, 'bundle', 'nested'))).toHaveLength(fileCount)
  })

  it('verifies the first private copy before publishing it', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourceFile = path.join(legacyWorkspace, 'ordinary.txt')
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(sourceFile, 'AAAA')

    const session = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    copyMutation.afterCopyFile = async (copiedSourcePath, copiedDestinationPath) => {
      if (
        copiedSourcePath !== sourceFile ||
        !path.basename(copiedDestinationPath).startsWith(`.${FINAL_LATEST_SESSION_ID}.migration-`)
      ) {
        return
      }
      await writeFile(copiedDestinationPath, 'BBBB')
    }

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [session]
      })
    ).rejects.toThrow(/copy verification failed/)

    expect(await readFile(sourceFile, 'utf8')).toBe('AAAA')
    await expect(access(path.join(session.systemWorkspacePath!, 'ordinary.txt'))).rejects.toThrow()
  })

  it.runIf(process.platform !== 'win32')(
    'reuses the first ordinary-content copy when a directory contains symlinks',
    async () => {
      const { agentsDataRoot, legacyWorkspace } = await createFixture()
      const sourceBundle = path.join(legacyWorkspace, 'bundle')
      await mkdir(sourceBundle, { recursive: true })
      await writeFile(path.join(sourceBundle, 'payload.txt'), 'workspace content')
      await symlink('payload.txt', path.join(sourceBundle, 'payload-link'))
      await symlink(path.join(sourceBundle, 'payload.txt'), path.join(sourceBundle, 'absolute-payload-link'))

      const sessions = [
        sessionPlan(agentsDataRoot, legacyWorkspace, {
          sourceSessionId: 'session_old',
          finalSessionId: FINAL_OLD_SESSION_ID,
          createdAt: Date.parse('2026-05-01T00:00:00Z'),
          updatedAt: Date.parse('2026-05-02T00:00:00Z')
        }),
        sessionPlan(agentsDataRoot, legacyWorkspace, {
          sourceSessionId: 'session_latest',
          finalSessionId: FINAL_LATEST_SESSION_ID,
          createdAt: Date.parse('2026-07-22T00:00:00Z'),
          updatedAt: Date.parse('2026-07-23T00:00:00Z')
        })
      ]

      await stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions
      })

      expect(
        copyMutation.copyFileCalls.filter(([sourcePath]) => sourcePath === path.join(sourceBundle, 'payload.txt'))
      ).toHaveLength(1)
      for (const session of sessions) {
        expect(await readFile(path.join(session.systemWorkspacePath!, 'bundle', 'payload.txt'), 'utf8')).toBe(
          'workspace content'
        )
        expect(await readlink(path.join(session.systemWorkspacePath!, 'bundle', 'payload-link'))).toBe('payload.txt')
        expect(await readlink(path.join(session.systemWorkspacePath!, 'bundle', 'absolute-payload-link'))).toBe(
          path.join(session.systemWorkspacePath!, 'bundle', 'payload.txt')
        )
      }
    }
  )

  it('aborts if a cached workspace source changes while its private copy is reused', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourceFile = path.join(legacyWorkspace, 'ordinary.txt')
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(sourceFile, 'original workspace content')

    const sessions = [
      sessionPlan(agentsDataRoot, legacyWorkspace, {
        sourceSessionId: 'session_old',
        finalSessionId: FINAL_OLD_SESSION_ID,
        createdAt: Date.parse('2026-05-01T00:00:00Z'),
        updatedAt: Date.parse('2026-05-02T00:00:00Z')
      }),
      sessionPlan(agentsDataRoot, legacyWorkspace, {
        sourceSessionId: 'session_latest',
        finalSessionId: FINAL_LATEST_SESSION_ID,
        createdAt: Date.parse('2026-07-22T00:00:00Z'),
        updatedAt: Date.parse('2026-07-23T00:00:00Z')
      })
    ]
    let reusedCopies = 0
    copyMutation.afterCopyFile = async (copiedSourcePath) => {
      if (copiedSourcePath === sourceFile || ++reusedCopies !== 1) return
      await writeFile(sourceFile, 'changed workspace content')
    }

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions
      })
    ).rejects.toThrow(/changed while being copied/)

    expect(await readFile(sourceFile, 'utf8')).toBe('changed workspace content')
    for (const session of sessions) {
      await expect(access(path.join(session.systemWorkspacePath!, 'ordinary.txt'))).rejects.toThrow()
      expect(
        (await readdir(path.dirname(session.systemWorkspacePath!))).every(
          (entry) => !entry.startsWith(`.${path.basename(session.systemWorkspacePath!)}.migration-`)
        )
      ).toBe(true)
    }
    copyMutation.afterCopyFile = undefined
    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions
    })

    for (const session of sessions) {
      expect(await readFile(path.join(session.systemWorkspacePath!, 'ordinary.txt'), 'utf8')).toBe(
        'changed workspace content'
      )
    }
  })

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

  it('validates every cleanup target before deleting any destination', async () => {
    const { agentsDataRoot } = await createFixture()
    const preservedTarget = path.join(agentsDataRoot, FINAL_AGENT_ID)
    const overlappingAgentId = 'overlap'
    const overlappingSource = legacyAgentWorkspacePath(agentsDataRoot, overlappingAgentId)
    await mkdir(preservedTarget, { recursive: true })
    await writeFile(path.join(preservedTarget, 'keep.txt'), 'keep me')
    await mkdir(overlappingSource, { recursive: true })
    await writeFile(path.join(overlappingSource, 'SOUL.md'), 'legacy source')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [
          { sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID },
          { sourceAgentId: overlappingAgentId, finalAgentId: overlappingAgentId }
        ],
        sessions: []
      })
    ).rejects.toThrow(/cleanup target overlaps a legacy source/i)

    expect(await readFile(path.join(preservedTarget, 'keep.txt'), 'utf8')).toBe('keep me')
    expect(await readFile(path.join(overlappingSource, 'SOUL.md'), 'utf8')).toBe('legacy source')
  })

  it('rejects nested cleanup targets before deleting either destination', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const preservedTarget = path.join(agentsDataRoot, FINAL_AGENT_ID)
    await mkdir(preservedTarget, { recursive: true })
    await writeFile(path.join(preservedTarget, 'keep.txt'), 'keep me')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    latestSession.systemWorkspacePath = path.join(preservedTarget, 'nested-session')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).rejects.toThrow(/cleanup targets overlap/i)

    expect(await readFile(path.join(preservedTarget, 'keep.txt'), 'utf8')).toBe('keep me')
  })

  it('rejects a legacy source nested inside a cleanup target before deleting it', async () => {
    const { agentsDataRoot } = await createFixture()
    const preservedTarget = path.join(agentsDataRoot, FINAL_AGENT_ID)
    const nestedSource = path.join(preservedTarget, 'legacy-source')
    await mkdir(nestedSource, { recursive: true })
    await writeFile(path.join(nestedSource, 'SOUL.md'), 'legacy source')

    const externalSession = sessionPlan(agentsDataRoot, nestedSource, {
      sourceSessionId: 'session_external',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [externalSession]
      })
    ).rejects.toThrow(/cleanup target overlaps a legacy source/i)

    expect(await readFile(path.join(nestedSource, 'SOUL.md'), 'utf8')).toBe('legacy source')
  })

  it('rejects a cleanup target nested inside a legacy source before deleting it', async () => {
    const { agentsDataRoot } = await createFixture()
    const preservedTarget = path.join(agentsDataRoot, FINAL_AGENT_ID)
    await mkdir(preservedTarget, { recursive: true })
    await writeFile(path.join(preservedTarget, 'keep.txt'), 'keep me')

    const externalSession = sessionPlan(agentsDataRoot, agentsDataRoot, {
      sourceSessionId: 'session_external',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [externalSession]
      })
    ).rejects.toThrow(/cleanup target overlaps a legacy source/i)

    expect(await readFile(path.join(preservedTarget, 'keep.txt'), 'utf8')).toBe('keep me')
  })

  it('does not treat a path-component prefix as an ancestor', async () => {
    const { agentsDataRoot } = await createFixture()
    const prefixSource = path.join(agentsDataRoot, `${FINAL_AGENT_ID}-legacy`)
    const agentDataPath = path.join(agentsDataRoot, FINAL_AGENT_ID)
    await mkdir(prefixSource, { recursive: true })
    await writeFile(path.join(prefixSource, 'SOUL.md'), 'legacy soul')
    await mkdir(agentDataPath, { recursive: true })
    await writeFile(path.join(agentDataPath, 'stale.txt'), 'stale target')

    const externalSession = sessionPlan(agentsDataRoot, prefixSource, {
      sourceSessionId: 'session_external',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: [externalSession]
    })

    expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('legacy soul')
    await expect(access(path.join(agentDataPath, 'stale.txt'))).rejects.toThrow()
    expect(await readFile(path.join(prefixSource, 'SOUL.md'), 'utf8')).toBe('legacy soul')
  })

  it.each([
    { platform: 'macOS', isMac: true, isWin: false },
    { platform: 'Windows', isMac: false, isWin: true }
  ])('rejects case-only path overlaps on $platform', async ({ isMac, isWin }) => {
    platformState.isMac = isMac
    platformState.isWin = isWin
    const { agentsDataRoot } = await createFixture()
    const finalAgentId = 'CaseSensitiveTarget'
    const preservedTarget = path.join(agentsDataRoot, finalAgentId)
    const caseVariantSource = path.join(agentsDataRoot, finalAgentId.toLowerCase())
    await mkdir(preservedTarget, { recursive: true })
    await writeFile(path.join(preservedTarget, 'keep.txt'), 'keep me')

    const externalSession = sessionPlan(agentsDataRoot, caseVariantSource, {
      sourceSessionId: 'session_external',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId }],
        sessions: [externalSession]
      })
    ).rejects.toThrow(/cleanup target overlaps a legacy source/i)

    expect(await readFile(path.join(preservedTarget, 'keep.txt'), 'utf8')).toBe('keep me')
  })

  it('rejects case-only cleanup target duplicates on case-insensitive platforms', async () => {
    platformState.isMac = true
    const { agentsDataRoot } = await createFixture()
    const firstTarget = path.join(agentsDataRoot, 'CaseSensitiveTarget')
    await mkdir(firstTarget, { recursive: true })
    await writeFile(path.join(firstTarget, 'keep.txt'), 'keep me')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [
          { sourceAgentId: 'source-agent-one', finalAgentId: 'CaseSensitiveTarget' },
          { sourceAgentId: 'source-agent-two', finalAgentId: 'casesensitivetarget' }
        ],
        sessions: []
      })
    ).rejects.toThrow(/cleanup targets overlap/i)

    expect(await readFile(path.join(firstTarget, 'keep.txt'), 'utf8')).toBe('keep me')
  })

  it.runIf(process.platform === 'linux')('keeps case-only path variants distinct on Linux', async () => {
    const { agentsDataRoot } = await createFixture()
    const finalAgentId = 'CaseSensitiveTarget'
    const agentDataPath = path.join(agentsDataRoot, finalAgentId)
    const caseVariantSource = path.join(agentsDataRoot, finalAgentId.toLowerCase())
    await mkdir(caseVariantSource, { recursive: true })
    await writeFile(path.join(caseVariantSource, 'SOUL.md'), 'legacy soul')
    await mkdir(agentDataPath, { recursive: true })
    await writeFile(path.join(agentDataPath, 'stale.txt'), 'stale target')

    const externalSession = sessionPlan(agentsDataRoot, caseVariantSource, {
      sourceSessionId: 'session_external',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })

    await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId }],
      sessions: [externalSession]
    })

    expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('legacy soul')
    expect(await readFile(path.join(caseVariantSource, 'SOUL.md'), 'utf8')).toBe('legacy soul')
  })

  it.runIf(process.platform !== 'win32')(
    'rejects a legacy source whose real path points at a cleanup target',
    async () => {
      const { tempRoot, agentsDataRoot } = await createFixture()
      const preservedTarget = path.join(agentsDataRoot, FINAL_AGENT_ID)
      const linkedSource = path.join(tempRoot, 'linked-source')
      await mkdir(preservedTarget, { recursive: true })
      await writeFile(path.join(preservedTarget, 'keep.txt'), 'keep me')
      await symlink(preservedTarget, linkedSource)

      const externalSession = sessionPlan(agentsDataRoot, linkedSource, {
        sourceSessionId: 'session_external',
        finalSessionId: FINAL_LATEST_SESSION_ID,
        createdAt: Date.parse('2026-07-22T00:00:00Z'),
        updatedAt: Date.parse('2026-07-23T00:00:00Z'),
        managed: false
      })

      await expect(
        stageLegacyAgentFiles({
          agentsDataRoot,
          agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
          sessions: [externalSession]
        })
      ).rejects.toThrow(/cleanup target overlaps a legacy source/i)

      expect(await readFile(path.join(preservedTarget, 'keep.txt'), 'utf8')).toBe('keep me')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'removes a destination symlink without touching its external target',
    async () => {
      const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
      const externalTarget = path.join(tempRoot, 'external-target')
      const agentDataPath = path.join(agentsDataRoot, FINAL_AGENT_ID)
      await mkdir(legacyWorkspace, { recursive: true })
      await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'legacy soul')
      await mkdir(externalTarget)
      await writeFile(path.join(externalTarget, 'keep.txt'), 'external data')
      await symlink(externalTarget, agentDataPath)

      await stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: []
      })

      expect((await lstat(agentDataPath)).isDirectory()).toBe(true)
      expect((await lstat(agentDataPath)).isSymbolicLink()).toBe(false)
      expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('legacy soul')
      expect(await readFile(path.join(externalTarget, 'keep.txt'), 'utf8')).toBe('external data')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'rejects a symlinked cleanup parent before deleting another destination',
    async () => {
      const { tempRoot, agentsDataRoot, legacyWorkspace } = await createFixture()
      const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
        sourceSessionId: 'session_latest',
        finalSessionId: FINAL_LATEST_SESSION_ID,
        createdAt: Date.parse('2026-07-22T00:00:00Z'),
        updatedAt: Date.parse('2026-07-23T00:00:00Z')
      })
      const preservedTarget = path.join(agentsDataRoot, FINAL_AGENT_ID)
      const externalSystemRoot = path.join(tempRoot, 'external-system')
      await mkdir(legacyWorkspace, { recursive: true })
      await writeFile(path.join(legacyWorkspace, 'ordinary.txt'), 'legacy workspace')
      await mkdir(preservedTarget)
      await writeFile(path.join(preservedTarget, 'keep.txt'), 'keep me')
      await mkdir(externalSystemRoot)
      await writeFile(path.join(externalSystemRoot, 'keep.txt'), 'external data')
      await symlink(externalSystemRoot, path.join(agentsDataRoot, 'system'))

      await expect(
        stageLegacyAgentFiles({
          agentsDataRoot,
          agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
          sessions: [latestSession]
        })
      ).rejects.toThrow(/contains a symbolic link/i)

      expect(await readFile(path.join(preservedTarget, 'keep.txt'), 'utf8')).toBe('keep me')
      expect(await readFile(path.join(externalSystemRoot, 'keep.txt'), 'utf8')).toBe('external data')
    }
  )

  it('replaces an existing identity target without changing the legacy source', async () => {
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
    await writeFile(path.join(agentDataPath, 'V2-ONLY.md'), 'stale agent data')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).resolves.toBeUndefined()

    expect(await readFile(path.join(agentDataPath, 'SOUL.md'), 'utf8')).toBe('legacy soul')
    await expect(access(path.join(agentDataPath, 'V2-ONLY.md'))).rejects.toThrow()
    expect(await readFile(path.join(legacyWorkspace, 'SOUL.md'), 'utf8')).toBe('legacy soul')
  })

  it('clears existing memory before copying retry data', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourceMemoryPath = path.join(legacyWorkspace, 'memory')
    await mkdir(sourceMemoryPath, { recursive: true })
    await writeFile(path.join(sourceMemoryPath, 'JOURNAL.jsonl'), '{"legacy":true}\n')
    await writeFile(path.join(sourceMemoryPath, 'FACT.md'), 'new legacy fact')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z'),
      managed: false
    })
    const destinationMemoryPath = path.join(agentsDataRoot, FINAL_AGENT_ID, 'memory')
    await mkdir(destinationMemoryPath, { recursive: true })
    await writeFile(path.join(destinationMemoryPath, 'JOURNAL.jsonl'), '{"stale":true}\n')
    await writeFile(path.join(destinationMemoryPath, 'V2-ONLY.md'), 'existing v2 memory')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).resolves.toBeUndefined()

    expect(await readFile(path.join(destinationMemoryPath, 'FACT.md'), 'utf8')).toBe('new legacy fact')
    expect(await readFile(path.join(destinationMemoryPath, 'JOURNAL.jsonl'), 'utf8')).toBe('{"legacy":true}\n')
    await expect(access(path.join(destinationMemoryPath, 'V2-ONLY.md'))).rejects.toThrow()
    expect(await readFile(path.join(sourceMemoryPath, 'FACT.md'), 'utf8')).toBe('new legacy fact')
  })

  it('replaces identity when the v1 source changes before a retry', async () => {
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
    await expect(stageLegacyAgentFiles(input)).resolves.toBeUndefined()

    expect(await readFile(path.join(legacyWorkspace, 'SOUL.md'), 'utf8')).toBe('newer soul')
    expect(await readFile(path.join(legacyWorkspace, 'memory', 'FACT.md'), 'utf8')).toBe('newer fact')
    expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'SOUL.md'), 'utf8')).toBe('newer soul')
    expect(await readFile(path.join(agentsDataRoot, FINAL_AGENT_ID, 'memory', 'FACT.md'), 'utf8')).toBe('newer fact')
  })

  it('does not overwrite an identity target created after cleanup', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourceSoulPath = path.join(legacyWorkspace, 'SOUL.md')
    const destinationSoulPath = path.join(agentsDataRoot, FINAL_AGENT_ID, 'SOUL.md')
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(sourceSoulPath, 'legacy soul')
    copyMutation.afterCopyFile = async (sourcePath) => {
      if (sourcePath !== sourceSoulPath) return
      await writeFile(destinationSoulPath, 'concurrent soul')
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
    ).rejects.toThrow(/identity destination conflict/i)

    expect(await readFile(destinationSoulPath, 'utf8')).toBe('concurrent soul')
    expect(await readFile(sourceSoulPath, 'utf8')).toBe('legacy soul')
  })

  it('replaces an existing ordinary workspace target without changing the source', async () => {
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
    ).resolves.toBeUndefined()

    expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'conflict.txt'), 'utf8')).toBe(
      'legacy workspace value'
    )
    expect(await readFile(path.join(legacyWorkspace, 'conflict.txt'), 'utf8')).toBe('legacy workspace value')
    expect(
      (await readdir(path.dirname(latestSession.systemWorkspacePath!))).every(
        (entry) => !entry.startsWith(`.${FINAL_LATEST_SESSION_ID}.migration-`)
      )
    ).toBe(true)
  })

  it('does not overwrite a workspace target created after cleanup', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourcePath = path.join(legacyWorkspace, 'conflict.txt')
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(sourcePath, 'legacy workspace value')

    const latestSession = sessionPlan(agentsDataRoot, legacyWorkspace, {
      sourceSessionId: 'session_latest',
      finalSessionId: FINAL_LATEST_SESSION_ID,
      createdAt: Date.parse('2026-07-22T00:00:00Z'),
      updatedAt: Date.parse('2026-07-23T00:00:00Z')
    })
    const destinationPath = path.join(latestSession.systemWorkspacePath!, 'conflict.txt')
    copyMutation.afterCopyFile = async (copiedSourcePath) => {
      if (copiedSourcePath !== sourcePath) return
      await writeFile(destinationPath, 'concurrent workspace value')
    }

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).rejects.toThrow(/workspace migration conflict/i)

    expect(await readFile(destinationPath, 'utf8')).toBe('concurrent workspace value')
    expect(await readFile(sourcePath, 'utf8')).toBe('legacy workspace value')
  })

  it('replaces a partial directory destination and removes destination-only data', async () => {
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
    await writeFile(path.join(destinationBundle, 'V2-ONLY.txt'), 'stale')

    await expect(
      stageLegacyAgentFiles({
        agentsDataRoot,
        agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
        sessions: [latestSession]
      })
    ).resolves.toBeUndefined()

    expect(await readFile(path.join(destinationBundle, 'first.txt'), 'utf8')).toBe('first')
    expect(await readFile(path.join(sourceBundle, 'second.txt'), 'utf8')).toBe('second')
    expect(await readFile(path.join(destinationBundle, 'second.txt'), 'utf8')).toBe('second')
    await expect(access(path.join(destinationBundle, 'V2-ONLY.txt'))).rejects.toThrow()
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

  it('rebuilds an identical completed destination while keeping the v1 source', async () => {
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

    expect(
      copyMutation.copyFileCalls.filter(([sourcePath]) => sourcePath === path.join(legacyWorkspace, 'completed.txt'))
    ).toHaveLength(1)
    expect(await readFile(path.join(legacyWorkspace, 'completed.txt'), 'utf8')).toBe('copied value')
    expect(await readFile(path.join(latestSession.systemWorkspacePath!, 'completed.txt'), 'utf8')).toBe('copied value')
  })

  it('aborts before publishing when a source changes during the copy window', async () => {
    const { agentsDataRoot, legacyWorkspace } = await createFixture()
    const sourcePath = path.join(legacyWorkspace, 'race.txt')
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(sourcePath, 'copied value')
    const originalStat = await stat(sourcePath)
    copyMutation.afterCopyFile = async (copiedSourcePath) => {
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
    ).rejects.toThrow(/changed while being (?:read|copied)/)

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
