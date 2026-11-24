import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { evaluateUserDataSqliteGuard, USER_DATA_SQLITE_GUARD_REASON } from '../userDataSqliteGuard'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, realpath: vi.fn(actual.realpath), lstat: vi.fn(actual.lstat) }
})

let root: string
let userData: string
let database: string
let workspace: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'sqlite-guard-errno-'))
  userData = path.join(root, 'userdata')
  database = path.join(userData, 'main.sqlite')
  workspace = path.join(userData, 'workspace')
  await mkdir(workspace, { recursive: true })
  await writeFile(database, '')
})

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(realpath).mockImplementation(actual.realpath)
  vi.mocked(lstat).mockImplementation(actual.lstat)
  vi.mocked(application.getPath).mockImplementation((key) => (key === 'app.database.file' ? database : userData))
})

afterAll(async () => {
  vi.mocked(application.getPath).mockReset()
  await rm(root, { recursive: true, force: true })
})

describe('SQLite guard filesystem failures', () => {
  it.each(['target', 'parent', 'lstat'] as const)('denies writes when %s resolution is uncertain', async (stage) => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const target = path.join(workspace, stage === 'parent' ? 'missing-parent/new.sqlite' : 'uncertain.sqlite')
    const evaluate = () =>
      evaluateUserDataSqliteGuard({
        runtime: 'claude-code',
        toolName: 'Write',
        args: { file_path: target },
        cwd: workspace,
        workspacePath: workspace
      })

    await expect(evaluate()).resolves.toBeUndefined()

    for (const failure of [
      null,
      Object.defineProperty({}, 'code', {
        get() {
          throw new Error('unreadable code')
        }
      })
    ]) {
      if (stage === 'lstat') {
        vi.mocked(lstat).mockImplementation((candidate, options) =>
          candidate === target ? Promise.reject(failure) : actual.lstat(candidate, options)
        )
      } else {
        const uncertain = stage === 'target' ? target : path.dirname(target)
        vi.mocked(realpath).mockImplementation((candidate, options) =>
          candidate === uncertain ? Promise.reject(failure) : actual.realpath(candidate, options)
        )
      }

      await expect(evaluate()).resolves.toEqual({
        ruleId: 'user-data-sqlite-write',
        reason: USER_DATA_SQLITE_GUARD_REASON
      })
    }
  })
})
