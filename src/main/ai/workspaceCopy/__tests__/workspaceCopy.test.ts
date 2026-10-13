import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@data/services/AgentTaskService'
import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceCopyRecordService as records } from '@data/services/AgentWorkspaceCopyRecordService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { AgentWorkspaceCopyService } from '../AgentWorkspaceCopyService'
import { copyWorkspaceFile } from '../copyWorkspaceFile'
import { pathsForCopy } from '../workspaceCopyOwnership'

const native = vi.hoisted(() => ({ copyFile: vi.fn() }))
vi.mock('@vscode/fs-copyfile', () => native)
vi.mock('node:fs/promises', { spy: true })

describe('workspace copy ownership and publication', () => {
  const dbh = setupTestDatabase()
  let root: string
  let source: string
  let service: AgentWorkspaceCopyService

  beforeEach(async () => {
    BaseService.resetInstances()
    root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'cherry-copy-test-')))
    source = path.join(root, 'source')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'hello.txt'), 'source contents')
    native.copyFile.mockReset().mockRejectedValue(Object.assign(new Error('No clone support'), { code: 'ENOTSUP' }))
    service = new AgentWorkspaceCopyService()
    await application.get('PreferenceService').set('agent.workspace_copy.storage_parent', null)
  })

  afterEach(async () => {
    await service._doStop()
    vi.restoreAllMocks()
    const resolved = await fs.realpath(root)
    if (
      !path.basename(resolved).startsWith('cherry-copy-test-') ||
      path.dirname(resolved) !== (await fs.realpath(tmpdir()))
    )
      throw new Error('Unexpected test cleanup target')
    await fs.rm(resolved, { recursive: true, force: true })
    BaseService.resetInstances()
  })

  async function create() {
    const workspace = agentWorkspaceService.findOrCreateByPath(source)
    const input = { requestId: randomUUID(), sourceWorkspaceId: workspace.id }
    const pending = await service.startCreate(input)
    await service.drain()
    return { input, row: records.get(pending.id) }
  }

  it('publishes an independent user workspace and preserves untracked files while excluding Git and dependencies', async () => {
    await fs.mkdir(path.join(source, '.git'))
    await fs.mkdir(path.join(source, 'node_modules'))
    await fs.writeFile(path.join(source, '.env'), 'local configuration')
    const { input, row } = await create()
    expect(row.state).toBe('ready')
    expect(row.statistics).toMatchObject({ files: 2, copiedFiles: 2, clonedFiles: 0, excludedEntries: 2 })
    expect(await fs.readdir(row.location.project)).toEqual(['.env', 'hello.txt'])
    const target = path.join(row.location.project, 'hello.txt')
    await fs.writeFile(target, 'copy changed')
    expect(await fs.readFile(path.join(source, 'hello.txt'), 'utf8')).toBe('source contents')
    await fs.writeFile(path.join(source, 'hello.txt'), 'source changed')
    expect(await fs.readFile(target, 'utf8')).toBe('copy changed')
    expect(agentWorkspaceService.getById(row.targetWorkspaceId!).storage).toEqual({
      type: 'managed-copy',
      copyId: row.id
    })
    expect((await service.startCreate(input)).id).toBe(row.id)
    await expect(service.startCreate({ ...input, name: 'different request' })).rejects.toMatchObject({
      code: 'request_conflict'
    })
  })

  it('never overwrites an unexpected destination or downgrades a real clone failure', async () => {
    const target = path.join(root, 'existing')
    await fs.writeFile(target, 'keep me')
    await expect(copyWorkspaceFile(path.join(source, 'hello.txt'), target)).rejects.toMatchObject({
      code: 'path_collision'
    })
    expect(await fs.readFile(target, 'utf8')).toBe('keep me')
    native.copyFile.mockRejectedValue(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }))
    await expect(copyWorkspaceFile(path.join(source, 'hello.txt'), path.join(root, 'new'))).rejects.toMatchObject({
      code: 'ENOSPC'
    })
    await expect(fs.stat(path.join(root, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for a submitted native write before cancelling and removing its unpublished tree', async () => {
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    native.copyFile.mockImplementation(async (from: string, to: string) => {
      entered.resolve()
      await finish.promise
      await fs.copyFile(from, to, constants.COPYFILE_EXCL)
    })
    const workspace = agentWorkspaceService.findOrCreateByPath(source)
    const pending = await service.startCreate({ requestId: randomUUID(), sourceWorkspaceId: workspace.id })
    await entered.promise
    const row = records.get(pending.id)
    const cancellation = service.cancel(row.id)
    expect((await fs.stat(pathsForCopy(row).staging)).isDirectory()).toBe(true)
    finish.resolve()
    const cancelled = await cancellation
    expect(cancelled).toMatchObject({ state: 'cancelled', cleanup: 'none', errorCode: 'cancelled' })
    await expect(fs.stat(row.location.root)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(agentWorkspaceService.list()).toHaveLength(1)
  })

  it('detects source replacement during copying and never publishes the incomplete workspace', async () => {
    native.copyFile.mockImplementation(async (from: string, to: string) => {
      await fs.copyFile(from, to, constants.COPYFILE_EXCL)
      await fs.writeFile(from, 'changed during copy')
    })
    const { row } = await create()
    expect(row).toMatchObject({
      state: 'failed',
      cleanup: 'none',
      targetWorkspaceId: null,
      errorCode: 'source_changed'
    })
  })

  it('retains a replaced project even when its container and manifest are unchanged', async () => {
    const { row } = await create()
    await fs.rename(row.location.project, path.join(row.location.root, 'original-project'))
    await fs.mkdir(row.location.project)
    await fs.writeFile(path.join(row.location.project, 'user.txt'), 'keep')
    await expect(service.remove(row.id, row.revision)).rejects.toMatchObject({ code: 'ownership_mismatch' })
    expect(await fs.readFile(path.join(row.location.project, 'user.txt'), 'utf8')).toBe('keep')
    expect(records.get(row.id).state).toBe('ready')
  })

  it('preserves a file arriving between the final directory listing and rmdir', async () => {
    const { row } = await create()
    const { rmdir } = await vi.importActual<typeof fs>('node:fs/promises')
    vi.spyOn(fs, 'rmdir').mockImplementation(async (directory) => {
      if (directory === row.location.root) await fs.writeFile(path.join(directory.toString(), 'late-user-file'), 'keep')
      return rmdir(directory)
    })
    const result = await service.remove(row.id, row.revision)
    expect(result).toMatchObject({ state: 'deleting', cleanup: 'blocked', cleanupReason: 'ENOTEMPTY' })
    expect(await fs.readFile(path.join(row.location.root, 'late-user-file'), 'utf8')).toBe('keep')
  })

  it('recovers failed cleanup debt without replacing the original outcome', async () => {
    native.copyFile.mockRejectedValue(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }))
    const { rm } = await vi.importActual<typeof fs>('node:fs/promises')
    const removal = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (target.toString().endsWith('project.disposal')) throw Object.assign(new Error('Busy'), { code: 'EBUSY' })
      return rm(target, options)
    })
    const { row } = await create()
    expect(row).toMatchObject({ state: 'failed', cleanup: 'pending', errorCode: 'ENOSPC' })
    removal.mockRestore()
    await service.recoverPending()
    expect(records.get(row.id)).toMatchObject({ state: 'failed', cleanup: 'none', errorCode: 'ENOSPC' })
    await expect(fs.stat(row.location.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps ready files after source and workspace rows are removed, and relinks only the exact project', async () => {
    const { row } = await create()
    dbh.db.delete(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, row.sourceWorkspaceId!)).run()
    dbh.db.delete(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, row.targetWorkspaceId!)).run()
    expect(records.get(row.id)).toMatchObject({ state: 'ready', sourceWorkspaceId: null, targetWorkspaceId: null })
    await expect(service.registerWorkspacePath({ path: row.location.root })).rejects.toMatchObject({
      code: 'managed_workspace_path'
    })
    const relinked = await service.registerWorkspacePath({ path: row.location.project })
    expect(relinked).toMatchObject({ id: row.reservedWorkspaceId, storage: { type: 'managed-copy', copyId: row.id } })
    expect(await fs.readFile(path.join(relinked.path, 'hello.txt'), 'utf8')).toBe('source contents')
  })

  it('rejects new references after deleting starts, including direct synchronous data writers', async () => {
    const { row } = await create()
    const agentId = randomUUID()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Test', instructions: '', orderKey: 'a0' }).run()
    const workspace = { type: 'user' as const, workspaceId: row.targetWorkspaceId! }
    const entered = Promise.withResolvers<void>()
    const proceed = Promise.withResolvers<void>()
    const { rm } = await vi.importActual<typeof fs>('node:fs/promises')
    vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (target.toString().endsWith('project.disposal')) {
        entered.resolve()
        await proceed.promise
      }
      return rm(target, options)
    })
    const removal = service.remove(row.id, row.revision)
    await entered.promise
    try {
      expect(records.get(row.id).state).toBe('deleting')
      expect(() => agentSessionService.create({ agentId, name: 'Late', workspace })).toThrow('workspace_unavailable')
      expect(() => agentSessionService.reuseOrCreatePlaceholderWithImpact({ agentId, workspace })).toThrow(
        'workspace_unavailable'
      )
      expect(() =>
        agentChannelService.createChannel({
          type: 'telegram',
          name: 'Late',
          workspace,
          isActive: false,
          config: { bot_token: '', allowed_chat_ids: [] }
        })
      ).toThrow('workspace_unavailable')
      expect(() => agentWorkspaceService.findOrCreateByPath(row.location.project)).toThrow('managed_workspace_path')
      await expect(service.registerWorkspacePath({ path: row.location.root })).rejects.toMatchObject({
        code: 'managed_workspace_path'
      })
      expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(0)
    } finally {
      proceed.resolve()
    }
    expect(await removal).toMatchObject({ state: 'removed', cleanup: 'none' })
  })

  it.each(['session', 'trash', 'channel', 'task'] as const)('retains a copy referenced by %s', async (kind) => {
    const { row } = await create()
    const agentId = randomUUID()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Test', instructions: '', orderKey: 'a0' }).run()
    const workspace = { type: 'user' as const, workspaceId: row.targetWorkspaceId! }
    if (kind === 'session' || kind === 'trash') {
      const session = agentSessionService.create({ agentId, name: 'User work', workspace })
      expect(session.workspace.storage).toEqual({ type: 'managed-copy', copyId: row.id })
      if (kind === 'trash')
        dbh.db
          .update(agentSessionTable)
          .set({ deletedAt: Date.now() })
          .where(eq(agentSessionTable.id, session.id))
          .run()
    } else if (kind === 'channel') {
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'User bot',
        workspace,
        isActive: false,
        config: { bot_token: '', allowed_chat_ids: [] }
      })
    } else {
      jobScheduleService.create({
        type: 'agent.task',
        name: 'user-task',
        trigger: { kind: 'interval', ms: 60000 },
        catchUpPolicy: { kind: 'skip-missed' },
        jobInputTemplate: { workspace }
      })
    }
    await expect(service.remove(row.id, row.revision)).rejects.toMatchObject({ message: 'workspace_in_use' })
    expect(records.get(row.id).state).toBe('ready')
    expect(await fs.readFile(path.join(row.location.project, 'hello.txt'), 'utf8')).toBe('source contents')
  })

  it('holds a source-copy lease through the scoped consumer and drains cancellation before releasing it', async () => {
    const { row } = await create()
    const entered = Promise.withResolvers<void>()
    const proceed = Promise.withResolvers<void>()
    const controller = new AbortController()
    const child = service.withPreparedCopy(
      { requestId: randomUUID(), sourceWorkspaceId: row.targetWorkspaceId! },
      { consumer: 'session-fork', signal: controller.signal, requestCancel: () => controller.abort() },
      async () => {
        entered.resolve()
        await proceed.promise
        controller.signal.throwIfAborted()
      }
    )
    const rejected = expect(child).rejects.toThrow()
    await entered.promise
    try {
      await expect(service.remove(row.id, row.revision)).rejects.toMatchObject({ code: 'workspace_in_use' })
    } finally {
      controller.abort()
      proceed.resolve()
    }
    await rejected
    expect(await service.remove(row.id, records.get(row.id).revision)).toMatchObject({ state: 'removed' })
  })

  it('does not roll back a committed workspace when the consumer reports a late error', async () => {
    const workspace = agentWorkspaceService.findOrCreateByPath(source)
    const requestId = randomUUID()
    const controller = new AbortController()
    await service.withPreparedCopy(
      { requestId, sourceWorkspaceId: workspace.id },
      { consumer: 'standalone', signal: controller.signal, requestCancel: () => controller.abort() },
      async (prepared) => {
        await service.assertPreparedCopy(prepared)
        dbh.db.transaction((tx) => records.publishTx(tx, prepared))
        throw new Error('late response failure')
      }
    )
    const row = records.findRequest(requestId)!
    expect(row).toMatchObject({ state: 'ready', cleanup: 'none', errorCode: null })
    expect(await fs.readFile(path.join(row.location.project, 'hello.txt'), 'utf8')).toBe('source contents')
  })

  it('rejects configured storage inside the source and freezes the location of existing copies', async () => {
    const { row, input } = await create()
    await application.get('PreferenceService').set('agent.workspace_copy.storage_parent', source)
    await expect(service.startCreate({ ...input, requestId: randomUUID() })).rejects.toMatchObject({
      code: 'invalid_storage'
    })
    expect(await service.remove(row.id, row.revision)).toMatchObject({ state: 'removed', path: row.location.project })
    expect(await fs.readFile(path.join(source, 'hello.txt'), 'utf8')).toBe('source contents')
  })

  it('pauses admission until every hold is released', async () => {
    const workspace = agentWorkspaceService.findOrCreateByPath(source)
    const first = service.pauseAdmission()
    const second = service.pauseAdmission()
    first()
    await expect(
      service.startCreate({ requestId: randomUUID(), sourceWorkspaceId: workspace.id })
    ).rejects.toMatchObject({ code: 'writes_paused' })
    second()
    const { row } = await create()
    expect(row.state).toBe('ready')
  })

  it('retains an external link target when rejecting a source link', async () => {
    const external = path.join(root, 'external')
    await fs.mkdir(external)
    await fs.writeFile(path.join(external, 'user.txt'), 'keep me')
    await fs.symlink(external, path.join(source, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    const { row } = await create()
    expect(row).toMatchObject({ state: 'failed', errorCode: 'unsupported_link', cleanup: 'none' })
    expect(await fs.readFile(path.join(external, 'user.txt'), 'utf8')).toBe('keep me')
    await expect(fs.stat(row.location.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')(
    'preserves internal links and executable modes in an independent tree',
    async () => {
      await fs.chmod(path.join(source, 'hello.txt'), 0o755)
      await fs.symlink(path.join(source, 'hello.txt'), path.join(source, 'alias'))
      const { row } = await create()
      expect(row.state).toBe('ready')
      const target = path.join(row.location.project, 'hello.txt')
      expect((await fs.stat(target)).mode & 0o777).toBe(0o755)
      expect(await fs.realpath(path.join(row.location.project, 'alias'))).toBe(target)
      await fs.writeFile(path.join(row.location.project, 'alias'), 'copy only')
      expect(await fs.readFile(path.join(source, 'hello.txt'), 'utf8')).toBe('source contents')
    }
  )

  it('rechecks path aliases before recovering an interrupted deletion', async () => {
    const { row } = await create()
    dbh.db.transaction((tx) => records.beginDeleteTx(tx, row.id, row.revision))
    const aliasId = randomUUID()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: aliasId,
        orderKey: 'a0',
        type: 'user',
        name: 'Restored alias',
        path: path.join(row.location.project, 'nested')
      })
      .run()
    await service.recoverPending()
    const blocked = records.get(row.id)
    expect(blocked).toMatchObject({ state: 'deleting', cleanup: 'blocked', cleanupReason: 'workspace_in_use' })
    expect(await fs.readFile(path.join(row.location.project, 'hello.txt'), 'utf8')).toBe('source contents')
    dbh.db.delete(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, aliasId)).run()
    await service.retryCleanup(row.id, blocked.revision)
    expect(records.get(row.id).state).toBe('removed')
  })
})
