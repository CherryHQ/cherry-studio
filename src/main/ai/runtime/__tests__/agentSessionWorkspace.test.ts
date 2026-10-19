import { existsSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { t } from '@main/i18n'
import * as file from '@main/utils/file'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import {
  AgentSessionWorkspaceError,
  assertAgentSessionWorkspaceDirectory,
  prepareAgentSessionWorkspaceDirectory
} from '../agentSessionWorkspace'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>()
  return { ...original, stat: vi.fn(original.stat) }
})

vi.mock('@main/utils/file', async (importOriginal) => {
  const original = await importOriginal<typeof file>()
  return {
    ...original,
    canonicalizePathForContainment: vi.fn(original.canonicalizePathForContainment),
    getPathStatus: vi.fn(original.getPathStatus)
  }
})

const actualFile = await vi.importActual<typeof file>('@main/utils/file')
const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises')

let profile: string
let root: string
const sessionId = 'workspace-containment-session'
const session = (cwd: string, type: 'system' | 'user' = 'system') =>
  ({ id: sessionId, workspace: { type, path: cwd } }) as AgentSessionEntity
const prepare = (cwd: string) => prepareAgentSessionWorkspaceDirectory(session(cwd))
const outsideMessage = (cwd: string) =>
  `Workspace check failed for session ${sessionId}: The system workspace could not be confirmed inside the current managed workspace root: ${cwd}. Check the session workspace and data directory settings.`

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(stat).mockReset().mockImplementation(actualFs.stat)
  vi.mocked(file.canonicalizePathForContainment)
    .mockReset()
    .mockImplementation(actualFile.canonicalizePathForContainment)
  vi.mocked(file.getPathStatus).mockReset().mockImplementation(actualFile.getPathStatus)
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
  profile = await mkdtemp(path.join(tmpdir(), 'workspace-containment-'))
  root = path.join(profile, 'P', 'Data', 'Agents', 'system')
  await mkdir(root, { recursive: true })
  vi.spyOn(application, 'getPath').mockReturnValue(root)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(profile, { recursive: true, force: true })
})

it('R1 creates missing date and session directories through an ancestor alias', async () => {
  const alias = path.join(profile, 'A')
  await symlink(path.join(profile, 'P'), alias, 'junction')
  const cwd = path.join(alias, 'Data', 'Agents', 'system', '2026-10-19', sessionId)
  expect(existsSync(path.dirname(cwd))).toBe(false)
  await prepare(cwd)
  expect((await stat(path.join(root, '2026-10-19', sessionId))).isDirectory()).toBe(true)
  expect((await stat(cwd)).isDirectory()).toBe(true)
})

it('R3 names and localizes a different physical root without creating it', async () => {
  const old = path.join(profile, 'old-userData')
  const cwd = path.join(old, 'Data', 'Agents', 'system', '2026-10-19', sessionId)
  await expect(prepare(cwd)).rejects.toMatchObject({
    name: 'AgentSessionWorkspaceError',
    retryable: false,
    message: outsideMessage(cwd)
  })
  expect(existsSync(old)).toBe(false)
})

it('R5 accepts a strict descendant whose name starts with two dots', async () => {
  const cwd = path.join(root, '..archive')
  await prepare(cwd)
  expect((await stat(cwd)).isDirectory()).toBe(true)
})

it('R6 rejects a root-below symlink even when it re-reaches the root', async () => {
  await symlink(path.join(profile, 'P'), path.join(root, 'back'), 'junction')
  const cwd = path.join(root, 'back', 'Data', 'Agents', 'system', '2026-10-19', sessionId)
  const preparation = prepare(cwd)
  await expect(preparation).rejects.toBeInstanceOf(AgentSessionWorkspaceError)
  await expect(preparation).rejects.toMatchObject({
    message: expect.stringContaining(`Workspace check failed for session ${sessionId}: `)
  })
  expect(existsSync(path.dirname(cwd))).toBe(false)
  expect(existsSync(cwd)).toBe(false)
})

it.each([
  {
    code: 'EIO',
    retryable: true,
    title: 'classifies a transient stat failure during identity verification as retryable'
  },
  { code: 'EACCES', retryable: false, title: 'rejects an unconfirmed identity after an EACCES stat failure' }
])('$title', async ({ code, retryable }) => {
  const cwd = path.join(root, '2026-10-19', sessionId)
  vi.mocked(stat).mockImplementation((async (candidate, options) => {
    if (candidate === cwd && options?.bigint && existsSync(cwd)) {
      throw Object.assign(new Error(code), { code })
    }
    return actualFs.stat(candidate, options)
  }) as typeof stat)
  const preparation = prepare(cwd)
  await expect(preparation).rejects.toBeInstanceOf(AgentSessionWorkspaceError)
  await expect(preparation).rejects.toMatchObject({
    retryable,
    message: retryable
      ? t('agent.session.workspace_status.check_failed', {
          sessionId,
          detail: t('agent.session.workspace_status.inaccessible', { path: cwd })
        })
      : outsideMessage(cwd)
  })
  expect(existsSync(cwd)).toBe(true)
})

it.each(['', '..' + path.sep + 'outside', path.join('2026-10-19', '..', '..', 'outside')])(
  'rejects root equality or traversal: %s',
  async (suffix) => {
    const cwd = path.resolve(root, suffix)
    await expect(prepare(cwd)).rejects.toBeInstanceOf(AgentSessionWorkspaceError)
    if (suffix) expect(existsSync(cwd)).toBe(false)
  }
)

it.each(['internal', 'external'])('rejects a %s descendant symlink before creating its leaf', async (kind) => {
  const destination = kind === 'internal' ? path.join(root, 'other') : path.join(profile, 'external')
  await mkdir(destination)
  await symlink(destination, path.join(root, 'link'), 'junction')
  const cwd = path.join(root, 'link', 'date', sessionId)
  await expect(prepare(cwd)).rejects.toMatchObject({
    name: 'AgentSessionWorkspaceError',
    message: expect.stringContaining(`Workspace check failed for session ${sessionId}: `)
  })
  expect(existsSync(path.join(destination, 'date'))).toBe(false)
})

it('rejects a managed root that is itself a symlink', async () => {
  const linkedRoot = path.join(profile, 'linked-root')
  await symlink(root, linkedRoot, 'junction')
  vi.mocked(application.getPath).mockReturnValue(linkedRoot)
  await expect(prepare(path.join(linkedRoot, sessionId))).rejects.toMatchObject({
    name: 'AgentSessionWorkspaceError',
    message: expect.stringContaining(`Workspace check failed for session ${sessionId}: `)
  })
  expect(existsSync(path.join(root, sessionId))).toBe(false)
})

it('names a missing USER directory without creating it', async () => {
  const cwd = path.join(profile, 'missing-user')
  await expect(prepareAgentSessionWorkspaceDirectory(session(cwd, 'user'))).rejects.toMatchObject({
    message: t('agent.session.workspace_status.check_failed', {
      sessionId,
      detail: t('agent.session.workspace_status.missing', { path: cwd })
    }),
    retryable: false
  })
  expect(existsSync(cwd)).toBe(false)
})

it('names a SYSTEM target that is a regular file', async () => {
  const cwd = path.join(root, sessionId)
  await writeFile(cwd, 'keep')
  await expect(prepare(cwd)).rejects.toMatchObject({
    name: 'AgentSessionWorkspaceError',
    message: expect.stringContaining(`Workspace check failed for session ${sessionId}: `),
    retryable: false
  })
  expect((await stat(cwd)).isFile()).toBe(true)
})

it.each([
  ['EIO', true],
  ['EBUSY', true],
  ['EMFILE', true],
  ['ENFILE', true],
  ['ENOSPC', true],
  ['ESTALE', true],
  ['ETIMEDOUT', true],
  ['EACCES', false],
  ['ENOENT', false]
] as const)('preserves %s retry classification', async (code, retryable) => {
  vi.mocked(file.getPathStatus).mockResolvedValueOnce({ ok: false, reason: 'inaccessible', code })
  await expect(assertAgentSessionWorkspaceDirectory(sessionId, path.join(root, code))).rejects.toMatchObject({
    name: 'AgentSessionWorkspaceError',
    message: expect.stringContaining(`Workspace check failed for session ${sessionId}: `),
    retryable
  })
})

it('rejects a relative SYSTEM cwd', async () => {
  await expect(prepare('relative/workspace')).rejects.toMatchObject({
    name: 'AgentSessionWorkspaceError',
    message: expect.stringContaining(`Workspace check failed for session ${sessionId}: `)
  })
})

it('fails closed when the managed root cannot be canonicalized', async () => {
  vi.mocked(file.canonicalizePathForContainment).mockResolvedValueOnce(undefined)
  const cwd = path.join(root, 'unknown', sessionId)
  await expect(prepare(cwd)).rejects.toMatchObject({ message: outsideMessage(cwd), retryable: false })
  expect(existsSync(cwd)).toBe(false)
})

it('does not report success when directory identity cannot be confirmed after creation', async () => {
  const cwd = path.join(root, sessionId)
  let targetIdentityChecks = 0
  vi.mocked(stat).mockImplementation((async (candidate, options) =>
    actualFs.stat(candidate === cwd && targetIdentityChecks++ === 0 ? profile : candidate, options)) as typeof stat)
  await expect(prepare(cwd)).rejects.toMatchObject({ message: outsideMessage(cwd), retryable: false })
})

it.each(['canonical', 'identity'])('R2 accepts ancestor spellings proven by %s', async (proof) => {
  const alias = path.join(profile, 'SHORT~1', 'Data', 'Agents', 'system')
  const cwd = path.join(alias, 'date', sessionId)
  const originalCanonicalize = vi.mocked(file.canonicalizePathForContainment).getMockImplementation()!
  const canonicalRoot = await originalCanonicalize(root, { allowMissing: false })
  vi.mocked(file.canonicalizePathForContainment).mockImplementation(async (candidate, options) =>
    candidate === alias ? (proof === 'canonical' ? canonicalRoot : alias) : originalCanonicalize(candidate, options)
  )
  vi.mocked(stat).mockImplementation((async (candidate, options) =>
    actualFs.stat(
      candidate === alias ? root : candidate === cwd ? path.join(root, 'date', sessionId) : candidate,
      options
    )) as typeof stat)
  const storage = await import('@main/ai/agents/agentDataDirectory')
  vi.spyOn(storage, 'assertAgentStoragePath').mockResolvedValue(undefined)
  vi.mocked(file.getPathStatus).mockResolvedValueOnce({ ok: true, kind: 'directory' })
  await prepare(cwd)
  expect((await stat(path.join(root, 'date', sessionId))).isDirectory()).toBe(true)
  expect(existsSync(path.join(profile, 'SHORT~1'))).toBe(false)
})

it('R2 win32 lexical contract accepts case/separators but requires identity proof for short names and rejects cross-drive', () => {
  const win = path.win32
  const managed = String.raw`C:\Users\runner1\Data\Agents\system`
  expect(win.relative(managed, String.raw`c:\Users\runner1\Data\Agents\system\date\id`)).toBe(String.raw`date\id`)
  expect(win.relative(managed, 'C:/Users/runner1/Data/Agents/system/date/id')).toBe(String.raw`date\id`)
  expect(win.relative(managed, String.raw`C:\Users\RUNNER~1\Data\Agents\system\date\id`)).toMatch(/^\.\.\\/)
  expect(win.isAbsolute(win.relative(managed, String.raw`D:\Users\runner1\Data\Agents\system\date\id`))).toBe(true)
  expect(win.relative(managed, win.join(managed, '..archive'))).toBe('..archive')
})
