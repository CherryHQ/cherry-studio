import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  evaluateUserDataSqliteGuard,
  isSameOrInsidePath,
  tokenizeShellCommand,
  USER_DATA_SQLITE_GUARD_REASON
} from '../userDataSqliteGuard'

const DENIAL = {
  ruleId: 'user-data-sqlite-write',
  reason: USER_DATA_SQLITE_GUARD_REASON
} as const

let root: string
let homePath: string
let userDataPath: string
let databaseFile: string
let workspacePath: string
let outsideWorkspace: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'user-data-sqlite-guard-'))
  homePath = path.join(root, 'home')
  userDataPath = path.join(homePath, 'Library', 'Application Support', 'Cherry Studio')
  databaseFile = path.join(userDataPath, 'Data', 'cherrystudio.sqlite')
  workspacePath = path.join(userDataPath, 'Data', 'Agents', 'system', 'session-1')
  outsideWorkspace = path.join(root, 'workspace')
  await Promise.all([
    mkdir(path.dirname(databaseFile), { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
    mkdir(outsideWorkspace, { recursive: true })
  ])
  await writeFile(databaseFile, '')
})

beforeEach(() => {
  vi.mocked(application.getPath).mockImplementation((key, filename) => {
    const base =
      key === 'app.userdata'
        ? userDataPath
        : key === 'app.database.file'
          ? databaseFile
          : key === 'sys.home'
            ? homePath
            : `/mock/${key}`
    return filename ? path.join(base, filename) : base
  })
})

afterAll(async () => {
  vi.mocked(application.getPath).mockReset()
  await rm(root, { recursive: true, force: true })
})

function evaluate(
  overrides: Partial<Parameters<typeof evaluateUserDataSqliteGuard>[0]> = {}
): ReturnType<typeof evaluateUserDataSqliteGuard> {
  return evaluateUserDataSqliteGuard({
    runtime: 'claude-code',
    toolName: 'Write',
    args: { file_path: databaseFile },
    cwd: workspacePath,
    workspacePath,
    ...overrides
  })
}

describe('evaluateUserDataSqliteGuard', () => {
  it.each(['', '-wal', '-shm', '-journal'])('protects the main database%s', async (suffix) => {
    await expect(evaluate({ args: { file_path: `${databaseFile}${suffix}` } })).resolves.toEqual(DENIAL)
  })

  it.each(['knowledge.db', 'knowledge.sqlite', 'knowledge.db-journal', 'knowledge.sqlite-shm'])(
    'protects other SQLite files under user data: %s',
    async (filename) => {
      const target = path.join(userDataPath, 'Data', filename)
      await expect(evaluate({ args: { file_path: target } })).resolves.toEqual(DENIAL)
    }
  )

  it('allows workspace-local SQLite only for a workspace strictly below user data', async () => {
    const localDatabase = path.join(workspacePath, 'artifacts.sqlite')
    await expect(evaluate({ args: { file_path: localDatabase } })).resolves.toBeUndefined()
    await expect(evaluate({ workspacePath: userDataPath, args: { file_path: localDatabase } })).resolves.toEqual(DENIAL)
    await expect(evaluate({ workspacePath: homePath, args: { file_path: localDatabase } })).resolves.toEqual(DENIAL)
  })

  it('never exempts the main database family even when it is inside the workspace', async () => {
    await expect(
      evaluate({ cwd: path.dirname(databaseFile), workspacePath: path.dirname(databaseFile) })
    ).resolves.toEqual(DENIAL)
  })

  it('allows SQLite outside user data and leaves structured reads untouched', async () => {
    const outsideDatabase = path.join(outsideWorkspace, 'project.sqlite')
    await expect(
      evaluate({ cwd: outsideWorkspace, workspacePath: outsideWorkspace, args: { file_path: outsideDatabase } })
    ).resolves.toBeUndefined()
    await expect(evaluate({ toolName: 'Read' })).resolves.toBeUndefined()
    await expect(evaluate({ runtime: 'pi', toolName: 'read', args: { path: databaseFile } })).resolves.toBeUndefined()
    await expect(
      evaluate({ runtime: 'dsh', toolName: 'read', args: { file_path: databaseFile } })
    ).resolves.toBeUndefined()
  })

  it.each([
    ['claude-code', 'Write', 'file_path'],
    ['claude-code', 'Edit', 'file_path'],
    ['claude-code', 'MultiEdit', 'file_path'],
    ['claude-code', 'NotebookEdit', 'notebook_path'],
    ['pi', 'write', 'path'],
    ['pi', 'edit', 'path'],
    ['dsh', 'write', 'file_path'],
    ['dsh', 'edit', 'file_path']
  ] as const)('binds %s %s.%s to the same policy', async (runtime, toolName, field) => {
    await expect(evaluate({ runtime, toolName, args: { [field]: databaseFile } })).resolves.toEqual(DENIAL)
  })

  it('does not scan third-party MCP arguments', async () => {
    await expect(
      evaluate({ runtime: 'pi', toolName: 'mcp__sqlite__execute', args: { path: databaseFile } })
    ).resolves.toBeUndefined()
  })

  it.runIf(process.platform !== 'win32')('denies symlink escapes and aliases to the main database', async () => {
    const protectedDirectory = path.join(userDataPath, 'Data', 'KnowledgeBase')
    const directoryLink = path.join(workspacePath, 'knowledge-link')
    const databaseLink = path.join(workspacePath, 'live-database')
    await mkdir(protectedDirectory, { recursive: true })
    await symlink(protectedDirectory, directoryLink)
    await symlink(databaseFile, databaseLink)

    await expect(evaluate({ args: { file_path: path.join(directoryLink, 'new.sqlite') } })).resolves.toEqual(DENIAL)
    await expect(evaluate({ args: { file_path: databaseLink } })).resolves.toEqual(DENIAL)
  })

  it.runIf(process.platform !== 'win32')('fails closed for dangling and cyclic symlinks', async () => {
    const dangling = path.join(workspacePath, 'dangling.sqlite')
    const cyclic = path.join(workspacePath, 'cyclic.sqlite')
    await symlink(path.join(workspacePath, 'missing.sqlite'), dangling)
    await symlink(path.basename(cyclic), cyclic)

    await expect(evaluate({ args: { file_path: dangling } })).resolves.toEqual(DENIAL)
    await expect(evaluate({ args: { file_path: cyclic } })).resolves.toEqual(DENIAL)
  })

  it('fails closed when cwd or root resolution is invalid', async () => {
    await expect(evaluate({ cwd: path.join(root, 'missing-cwd') })).resolves.toEqual(DENIAL)
    vi.mocked(application.getPath).mockImplementation((key) =>
      key === 'app.userdata'
        ? path.join(root, 'missing-user-data')
        : key === 'app.database.file'
          ? databaseFile
          : homePath
    )
    await expect(evaluate()).resolves.toEqual(DENIAL)
  })

  describe('literal shell scanning', () => {
    it.each([
      ['claude-code', 'Bash'],
      ['pi', 'bash'],
      ['dsh', 'bash'],
      ['dsh', 'pwsh']
    ] as const)('protects %s %s commands', async (runtime, toolName) => {
      await expect(evaluate({ runtime, toolName, args: { command: `sqlite3 "${databaseFile}"` } })).resolves.toEqual(
        DENIAL
      )
    })

    it('recognizes quoted paths, separators, initial-cwd relative paths, and sidecars', async () => {
      const relativeDatabase = path.relative(workspacePath, databaseFile)
      for (const command of [
        `sqlite3 '${databaseFile}' ; echo done`,
        `echo done | sqlite3 "${databaseFile}-wal"`,
        `sqlite3 ${relativeDatabase} && echo done`
      ]) {
        await expect(evaluate({ toolName: 'Bash', args: { command } })).resolves.toEqual(DENIAL)
      }
    })

    it('recognizes home literals, SQLite file URIs, and option values', async () => {
      const homeRelative = path.relative(homePath, databaseFile)
      const uri = pathToFileURL(databaseFile).toString()
      for (const command of [
        `sqlite3 "$HOME/${homeRelative}"`,
        `sqlite3 "\${HOME}/${homeRelative}"`,
        `sqlite3 "~/${homeRelative}"`,
        `sqlite3 "${uri}?mode=rw"`,
        `sqlite3 --database="${databaseFile}"`
      ]) {
        await expect(evaluate({ toolName: 'Bash', args: { command } })).resolves.toEqual(DENIAL)
      }
    })

    it('checks the full token so equals signs in filenames are preserved', async () => {
      const equalsDatabase = path.join(userDataPath, 'Data', 'name=value.sqlite')
      await expect(evaluate({ toolName: 'Bash', args: { command: `sqlite3 "${equalsDatabase}"` } })).resolves.toEqual(
        DENIAL
      )
    })

    it('preserves a UNC prefix at the start of an option value', () => {
      expect(tokenizeShellCommand(String.raw`sqlite3 --database="\\SERVER\Share\data.sqlite"`)).toContain(
        String.raw`--database=\\SERVER\Share\data.sqlite`
      )
    })

    it('does not strip query or fragment characters from ordinary paths', async () => {
      const ordinary = path.join(outsideWorkspace, 'project.sqlite?mode=rw')
      await expect(
        evaluate({
          toolName: 'Bash',
          cwd: outsideWorkspace,
          workspacePath: outsideWorkspace,
          args: { command: `sqlite3 "${ordinary}"` }
        })
      ).resolves.toBeUndefined()
    })
  })
})

describe('path comparison semantics', () => {
  it('uses Windows case-insensitive UNC containment', () => {
    expect(
      isSameOrInsidePath(
        '\\\\SERVER\\Share\\Cherry Studio\\Data\\file.sqlite',
        '\\\\server\\share\\cherry studio',
        'win32'
      )
    ).toBe(true)
  })

  it('uses macOS case-insensitive and Linux case-sensitive containment', () => {
    expect(isSameOrInsidePath('/Users/me/Library/Data/file.sqlite', '/users/ME/library', 'darwin')).toBe(true)
    expect(isSameOrInsidePath('/Users/me/Library/Data/file.sqlite', '/users/ME/library', 'linux')).toBe(false)
  })
})
