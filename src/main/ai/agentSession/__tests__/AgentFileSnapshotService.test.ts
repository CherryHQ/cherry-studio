import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs, {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { AgentFileSnapshotService } from '../AgentFileSnapshotService'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
describe('AgentFileSnapshotService', () => {
  let testDir: string
  let root: string
  let service: AgentFileSnapshotService
  const round = { sessionId: 'session', replyId: 'reply', inputMessageIds: ['input'] }
  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-test-'))
    root = path.join(testDir, 'workspace')
    await mkdir(root)
    vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
    BaseService.resetInstances()
    service = new AgentFileSnapshotService()
    vi.spyOn(service, 'workspaceRoots').mockResolvedValue([])
    await service.admitRound(round)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    BaseService.resetInstances()
    await rm(testDir, { recursive: true, force: true })
  })
  it('registers a round without creating snapshot files', async () => {
    await expect(stat(path.join(testDir, 'snapshots'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('reports no round without creating snapshots after the round finishes', async () => {
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(
      await service.protectWrite({
        round,
        callId: 'late',
        runtime: 'pi',
        toolName: 'write',
        filePath: path.join(root, 'file'),
        cwd: root,
        intent: { toolName: 'write', input: { content: 'data' } }
      })
    ).toEqual({ reason: 'no-round' })
    await expect(stat(path.join(testDir, 'snapshots'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects a snapshot root inside the workspace without changing git status', async () => {
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', root], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
    })
    vi.mocked(application.getPath).mockReturnValue(path.join(root, 'uncreated', 'snapshots'))
    await expect(
      service.protectWrite({
        round,
        callId: 'inside',
        runtime: 'pi',
        toolName: 'write',
        intent: { toolName: 'write', input: { content: 'changed' } },
        filePath: path.join(root, 'target'),
        cwd: root
      })
    ).rejects.toMatchObject({ code: 'SNAPSHOT_ROOT_IN_WORKSPACE' })
    expect(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
    await expect(stat(path.join(root, 'uncreated'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects the workspace itself and a symlink into it as snapshot roots', async () => {
    const alias = path.join(testDir, 'workspace-alias')
    await symlink(root, alias, 'dir')
    for (const snapshotRoot of [root, path.join(alias, 'snapshots')]) {
      vi.mocked(application.getPath).mockReturnValue(snapshotRoot)
      await expect(
        service.protectWrite({
          round,
          callId: 'inside',
          runtime: 'pi',
          toolName: 'write',
          intent: { toolName: 'write', input: { content: 'changed' } },
          filePath: path.join(root, 'target'),
          cwd: root
        })
      ).rejects.toMatchObject({ code: 'SNAPSHOT_ROOT_IN_WORKSPACE' })
    }
    await expect(stat(path.join(root, 'snapshots'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('refuses to undo an active turn without writing, then allows it after an idempotent finish', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await write(target, 'after', 'active')
    const manifestPath = path.join(testDir, 'snapshots/session/reply/manifest.json')
    const before = await readFile(manifestPath)
    const active = await service.getUndoState(round.sessionId)
    expect(active).toMatchObject({ canUndo: false, reason: 'turn-active' })
    expect(
      await service.undoCurrentRound({
        sessionId: round.sessionId,
        replyId: round.replyId,
        expectedRevision: active.revision!
      })
    ).toMatchObject({ reason: 'turn-active', files: [] })
    expect(await readFile(manifestPath)).toEqual(before)
    expect(await readFile(target, 'utf8')).toBe('after')
    await service.markRoundFinished(round.sessionId, round.replyId)
    const finished = await readFile(manifestPath)
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(await readFile(manifestPath)).toEqual(finished)
    const state = await service.getUndoState(round.sessionId)
    expect(state).toMatchObject({ canUndo: true, reason: null })
    expect(
      await service.undoCurrentRound({
        sessionId: round.sessionId,
        replyId: round.replyId,
        expectedRevision: state.revision!
      })
    ).toMatchObject({ reason: null, files: [{ status: 'restored' }] })
    expect(await readFile(target, 'utf8')).toBe('before')
  })
  it('fails closed when persisting the finished marker fails', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await write(target, 'after', 'failed-finish')
    const originalRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('manifest.json')) throw new Error('finish save failed')
      return originalRename(from, to)
    })
    await expect(service.markRoundFinished(round.sessionId, round.replyId)).resolves.toBeUndefined()
    expect(await service.getUndoState(round.sessionId)).toMatchObject({ canUndo: false, reason: 'failed' })
    expect(await readFile(target, 'utf8')).toBe('after')
  })
  async function write(target: string, value: string, callId: string) {
    const { attemptId } = await service.protectWrite({
      round,
      callId,
      runtime: 'pi',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: value } },
      filePath: target,
      cwd: root
    })
    await writeFile(target, value)
    await service.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
  }
  async function undo() {
    await service.markRoundFinished(round.sessionId, round.replyId)
    const state = await service.getUndoState(round.sessionId)
    return service.undoCurrentRound({
      sessionId: round.sessionId,
      replyId: round.replyId,
      expectedRevision: state.revision!
    })
  }
  it.skipIf(process.platform === 'win32').each([0o600, 0o755])(
    'keeps snapshot private and restores mode %i',
    async (mode) => {
      const target = path.join(root, 'file')
      await writeFile(target, 'before')
      await chmod(target, mode)
      await write(target, 'after', 'permissions')
      const snapshot = path.join(testDir, 'snapshots')
      const blobs = path.join(snapshot, 'session/reply/blobs')
      for (const dir of [snapshot, path.join(snapshot, 'session'), path.join(snapshot, 'session/reply'), blobs])
        expect((await stat(dir)).mode & 0o777).toBe(0o700)
      expect((await stat(path.join(blobs, (await readdir(blobs))[0]))).mode & 0o777).toBe(0o600)
      expect((await undo()).reason).toBeNull()
      expect((await stat(target)).mode & 0o7777).toBe(mode)
    }
  )
  it.skipIf(process.platform === 'win32')('restores special permission bits', async ({ skip }) => {
    const target = path.join(root, 'special')
    await writeFile(target, 'before')
    await chmod(target, 0o4755)
    if (((await stat(target)).mode & 0o7777) !== 0o4755) skip()
    await write(target, 'after', 'special-mode')
    expect((await undo()).reason).toBeNull()
    expect((await stat(target)).mode & 0o7777).toBe(0o4755)
  })
  it.skipIf(process.platform === 'win32')('detects a mode-only change as a conflict', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await chmod(target, 0o644)
    await write(target, 'after', 'mode-conflict')
    await chmod(target, 0o600)
    expect(await undo()).toMatchObject({ reason: 'conflict' })
    expect(await readFile(target, 'utf8')).toBe('after')
  })
  it('rejects a snapshot root inside another registered workspace', async () => {
    const other = path.join(testDir, 'other')
    await mkdir(other)
    vi.mocked(service.workspaceRoots).mockResolvedValue([root, other])
    vi.mocked(application.getPath).mockReturnValue(path.join(other, 'snapshots'))
    await expect(
      service.protectWrite({
        round,
        callId: 'other',
        runtime: 'pi',
        toolName: 'write',
        intent: { toolName: 'write', input: { content: 'changed' } },
        filePath: path.join(root, 'file'),
        cwd: root
      })
    ).rejects.toMatchObject({ code: 'SNAPSHOT_ROOT_IN_WORKSPACE' })
    expect(await readdir(other)).toEqual([])
  })
  it.skipIf(process.platform !== 'darwin')('deduplicates case aliases of an existing file', async ({ skip }) => {
    const target = path.join(root, 'File.txt')
    await writeFile(target, 'before')
    try {
      await stat(path.join(root, 'file.txt'))
    } catch {
      skip()
    }
    await write(target, 'first', 'case-one')
    await write(path.join(root, 'file.txt'), 'second', 'case-two')
    const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
    expect(manifest.files).toHaveLength(1)
    expect(await readdir(path.join(testDir, 'snapshots/session/reply/blobs'))).toHaveLength(1)
  })
  it('leaves an oversized write untouched while restoring other files', async () => {
    const large = path.join(root, 'large')
    const other = path.join(root, 'other')
    await writeFile(large, 'before')
    await writeFile(other, 'before')
    const { attemptId } = await service.protectWrite({
      round,
      callId: 'large',
      runtime: 'pi',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: '\0'.repeat(65 * 1024 * 1024) } },
      filePath: large,
      cwd: root
    })
    const handle = await open(large, 'w')
    await handle.truncate(65 * 1024 * 1024)
    await handle.close()
    await service.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
    await write(other, 'after', 'other')
    const result = await undo()
    expect(result.reason).toBe('unverifiable')
    expect(result.files).toContainEqual({ path: large, status: 'unverifiable', reason: 'unverifiable' })
    expect((await stat(large)).size).toBe(65 * 1024 * 1024)
    expect(await readFile(other, 'utf8')).toBe('before')
  })
  it('does not delete a user file created after a rejected write', async () => {
    const target = path.join(root, 'user-file')
    const { attemptId } = await service.protectWrite({
      round,
      callId: 'rejected',
      runtime: 'pi',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: 'changed' } },
      filePath: target,
      cwd: root
    })
    await writeFile(target, 'user content')
    await service.settleWrite({ round, attemptId: attemptId!, outcome: 'failure' })
    expect((await undo()).files).toEqual([{ path: target, status: 'skipped' }])
    expect(await readFile(target, 'utf8')).toBe('user content')
  })
  it('refuses undo while a write is pending', async () => {
    const target = path.join(root, 'pending')
    await service.protectWrite({
      round,
      callId: 'pending',
      runtime: 'pi',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: 'changed' } },
      filePath: target,
      cwd: root
    })
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(await service.getUndoState(round.sessionId)).toMatchObject({ canUndo: false, reason: 'pending' })
    expect((await undo()).reason).toBe('pending')
  })
  it('uses one baseline for a directory symlink alias', async () => {
    const real = path.join(root, 'real')
    const alias = path.join(root, 'alias')
    await mkdir(real)
    await symlink(real, alias, 'dir')
    const target = path.join(real, 'file')
    await writeFile(target, 'original')
    await write(target, 'first', 'one')
    await write(path.join(alias, 'file'), 'second', 'two')
    const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
    expect(manifest.files).toHaveLength(1)
    expect((await undo()).files[0].status).toBe('restored')
    expect(await readFile(target, 'utf8')).toBe('original')
  })
  it('clears the current round if admission fails', async () => {
    await expect(service.admitRound({ ...round, inputMessageIds: ['different'] })).rejects.toThrow()
    expect(await service.getUndoState(round.sessionId)).toMatchObject({ canUndo: false, reason: 'no-round' })
  })
  it('restores the first byte-exact baseline after repeated writes and leaves untouched files alone', async () => {
    const a = path.join(root, 'a'),
      b = path.join(root, 'b'),
      c = path.join(root, 'c')
    const original = Buffer.from([0xef, 0xbb, 0xbf, 0xff, 13, 10, 10, 13])
    await writeFile(a, original)
    await writeFile(b, 'before')
    await writeFile(c, 'untouched')
    const untouched = await stat(c)
    await write(a, 'one', '1')
    await write(a, 'two', '2')
    await write(a, 'three', '3')
    await write(b, 'changed', '4')
    expect((await undo()).files.map((f) => f.status)).toEqual(['restored', 'restored'])
    expect(hash(await readFile(a))).toBe(hash(original))
    expect(await readFile(b, 'utf8')).toBe('before')
    expect(await readFile(c, 'utf8')).toBe('untouched')
    expect((await stat(c)).mtimeMs).toBe(untouched.mtimeMs)
  })
  it('rejects the whole round on conflict and removes a created file when unchanged', async () => {
    const a = path.join(root, 'a'),
      b = path.join(root, 'b')
    await writeFile(a, 'baseline')
    await write(a, 'agent', '1')
    await write(b, 'new', '2')
    await writeFile(b, 'user')
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(await service.getUndoState(round.sessionId)).toMatchObject({
      canUndo: false,
      reason: 'conflict',
      files: [
        { path: a, status: 'changed' },
        { path: b, status: 'conflict' }
      ]
    })
    expect((await undo()).reason).toBe('conflict')
    expect(await readFile(a, 'utf8')).toBe('agent')
    await writeFile(b, 'new')
    expect((await undo()).files.map((f) => f.status)).toEqual(['restored', 'removed'])
  })
  it('rejects stale revisions and purges session snapshots', async () => {
    const target = path.join(root, 'a')
    await writeFile(target, 'a')
    await write(target, 'b', '1')
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(
      (await service.undoCurrentRound({ sessionId: 'session', replyId: 'reply', expectedRevision: '0' })).reason
    ).toBe('revision-mismatch')
    await service.purgeSessions(['session'])
    await expect(stat(path.join(testDir, 'snapshots', 'session'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  const call = (filePath: string, callId: string) => ({
    round,
    callId,
    runtime: 'pi' as const,
    toolName: 'write',
    intent: { toolName: 'write', input: { content: 'changed' } },
    filePath,
    cwd: root
  })

  it('refuses an unchanged pending attempt without writing the file', async () => {
    const target = path.join(root, 'pending')
    await writeFile(target, 'baseline')
    await service.protectWrite(call(target, 'pending'))
    const before = await stat(target)
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(await service.getUndoState(round.sessionId)).toMatchObject({ canUndo: false, reason: 'pending' })
    expect(await undo()).toMatchObject({ reason: 'pending', files: [] })
    expect((await stat(target)).mtimeMs).toBe(before.mtimeMs)
    expect(await readFile(target, 'utf8')).toBe('baseline')
  })

  it('rejects the entire round when a pending attempt differs from its baseline', async () => {
    const target = path.join(root, 'pending')
    const other = path.join(root, 'other')
    await writeFile(target, 'baseline')
    await writeFile(other, 'original')
    await write(other, 'changed', 'settled')
    await service.protectWrite(call(target, 'pending'))
    await writeFile(target, 'modified')
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(await service.getUndoState(round.sessionId)).toMatchObject({
      canUndo: false,
      reason: 'pending',
      files: [
        { path: other, status: 'changed' },
        { path: target, status: 'conflict' }
      ]
    })
    expect(await undo()).toMatchObject({ reason: 'pending' })
    expect(await readFile(target, 'utf8')).toBe('modified')
    expect(await readFile(other, 'utf8')).toBe('changed')
  })

  it('rejects an unreadable baseline', async () => {
    const target = path.join(root, 'unreadable')
    await writeFile(target, 'secret')
    await chmod(target, 0)
    try {
      await expect(service.protectWrite(call(target, '1'))).rejects.toThrow()
    } finally {
      await chmod(target, 0o600)
    }
  })
  it('rejects an oversized baseline', async () => {
    const target = path.join(root, 'large')
    const handle = await open(target, 'w')
    await handle.truncate(64 * 1024 * 1024 + 1)
    await handle.close()
    await expect(service.protectWrite(call(target, '1'))).rejects.toThrow('size limit')
  })
  it('captures one baseline for concurrent calls', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'original')
    const attempts = await Promise.all([
      service.protectWrite(call(target, '1')),
      service.protectWrite(call(target, '2'))
    ])
    expect(await readdir(path.join(testDir, 'snapshots/session/reply/blobs'))).toHaveLength(1)
    await writeFile(target, 'changed')
    for (const { attemptId } of attempts)
      await service.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
    expect((await undo()).files[0].status).toBe('restored')
    expect(await readFile(target, 'utf8')).toBe('original')
  })
  it('retains failed files for retry after a write failure', async () => {
    const a = path.join(root, 'a'),
      b = path.join(root, 'b')
    await writeFile(a, 'original a')
    await writeFile(b, 'original b')
    await write(a, 'changed a', '1')
    await write(b, 'changed b', '2')
    const originalRename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === b) throw new Error('injected write failure')
      return originalRename(from, to)
    })
    expect((await undo()).files.map((f) => f.status)).toEqual(['restored', 'failed'])
    spy.mockRestore()
    expect((await undo()).files.map((f) => f.status)).toEqual(['already-restored', 'restored'])
    expect(await readFile(a, 'utf8')).toBe('original a')
    expect(await readFile(b, 'utf8')).toBe('original b')
  })
  it('rejects a replaced target without changing other files', async () => {
    const a = path.join(root, 'a'),
      b = path.join(root, 'b')
    await writeFile(a, 'a')
    await writeFile(b, 'b')
    await write(a, 'changed a', '1')
    await write(b, 'changed b', '2')
    await rm(b)
    await writeFile(b, 'replacement')
    expect((await undo()).reason).toBe('conflict')
    expect(await readFile(a, 'utf8')).toBe('changed a')
    expect(await readFile(b, 'utf8')).toBe('replacement')
  })
  it('does not undo an earlier round when the current round is empty', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await write(target, 'after', '1')
    await service.admitRound({ ...round, replyId: 'empty' })
    await service.markRoundFinished(round.sessionId, 'empty')
    const state = await service.getUndoState(round.sessionId)
    expect(state).toMatchObject({ canUndo: false, reason: 'empty' })
    expect(
      (
        await service.undoCurrentRound({
          sessionId: round.sessionId,
          replyId: 'empty',
          expectedRevision: state.revision!
        })
      ).reason
    ).toBe('empty')
    expect(await readFile(target, 'utf8')).toBe('after')
  })
  it('rejects a replaced parent directory', async () => {
    const dir = path.join(root, 'dir'),
      target = path.join(dir, 'file')
    await mkdir(dir)
    await writeFile(target, 'before')
    await write(target, 'after', '1')
    await rename(dir, path.join(root, 'old'))
    await mkdir(dir)
    await writeFile(target, 'after')
    expect((await undo()).reason).toBe('conflict')
    expect(await readFile(target, 'utf8')).toBe('after')
  })
  it('sweeps stale orphans while retaining live and locked sessions', async () => {
    const snapshots = path.join(testDir, 'snapshots')
    await mkdir(snapshots)
    for (const id of ['orphan', 'live', 'locked']) {
      await mkdir(path.join(snapshots, id))
      await utimes(path.join(snapshots, id), 1, 1)
    }
    let release!: () => void
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = (
      service as unknown as { exclusive: (id: string, fn: () => Promise<void>) => Promise<void> }
    ).exclusive('locked', async () => {
      entered()
      await hold
    })
    await ready
    try {
      expect(
        await service.sweepOrphans(new Set(['session', 'live']), { freshnessGateMs: 1000, now: Date.now() })
      ).toEqual([path.join(snapshots, 'orphan')])
      await stat(path.join(snapshots, 'live'))
      await stat(path.join(snapshots, 'locked'))
    } finally {
      release()
      await locked
    }
  })
  it.skipIf(process.platform === 'win32')('restores POSIX permissions', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await chmod(target, 0o751)
    await write(target, 'after', '1')
    expect((await undo()).files[0].status).toBe('restored')
    expect((await stat(target)).mode & 0o777).toBe(0o751)
  })
  it('marks an undecidable intent unknown', async () => {
    const target = path.join(root, 'file')
    const { attemptId } = await service.protectWrite({
      ...call(target, '1'),
      intent: { toolName: 'NotebookEdit', input: {} }
    })
    await service.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(await service.getUndoState(round.sessionId)).toMatchObject({ canUndo: false, reason: 'unknown' })
  })
  it.each(['before', 'after'] as const)(
    'preserves a user save made %s settlement of the agent write',
    async (saveTime) => {
      const target = path.join(root, 'user-edit')
      await writeFile(target, 'A')
      const { attemptId } = await service.protectWrite({
        ...call(target, 'write'),
        intent: { toolName: 'write', input: { content: 'B' } }
      })
      await writeFile(target, 'B')
      if (saveTime === 'before') await writeFile(target, 'C')
      await service.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
      if (saveTime === 'after') await writeFile(target, 'C')
      await service.markRoundFinished(round.sessionId, round.replyId)
      const state = await service.getUndoState(round.sessionId)
      expect(state).toMatchObject({ canUndo: false, reason: 'conflict', files: [{ status: 'conflict' }] })
      expect(
        await service.undoCurrentRound({
          sessionId: round.sessionId,
          replyId: round.replyId,
          expectedRevision: state.revision!
        })
      ).toMatchObject({ reason: 'conflict', files: [{ status: 'conflict' }] })
      expect(await readFile(target, 'utf8')).toBe('C')
    }
  )
  it('preserves a user-modified file created by the agent', async () => {
    const target = path.join(root, 'created')
    await write(target, 'agent', 'create')
    await writeFile(target, 'user')
    const result = await undo()
    expect(result).toMatchObject({ reason: 'conflict', files: [{ status: 'conflict' }] })
    expect(await readFile(target, 'utf8')).toBe('user')
  })
  it.each([
    [
      'Edit',
      { old_string: '猫', new_string: '狗' },
      Buffer.from([0xff, ...Buffer.from('猫!')]),
      Buffer.from([0xff, ...Buffer.from('狗!')])
    ],
    ['Edit', { old_string: 'x', new_string: 'z', replace_all: true }, Buffer.from('x x'), Buffer.from('z z')],
    [
      'MultiEdit',
      {
        edits: [
          { old_string: 'x', new_string: 'y', replace_all: true },
          { old_string: 'y!', new_string: 'z' }
        ]
      },
      Buffer.from('x x!'),
      Buffer.from('y z')
    ],
    ['edit', { edits: [{ oldText: 'x', newText: 'z' }] }, Buffer.from('x!'), Buffer.from('z!')]
  ])(
    'derives %s intent from real file bytes and restores the baseline',
    async (toolName, input, baseline, expected) => {
      const target = path.join(root, 'edit')
      await writeFile(target, baseline)
      const attempt = await service.protectWrite({ ...call(target, 'edit'), intent: { toolName, input } })
      expect(attempt.classification).not.toBe('undecidable')
      await writeFile(target, expected)
      await service.settleWrite({ round, attemptId: attempt.attemptId!, outcome: 'success' })
      const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
      expect(manifest.files[0]).toMatchObject({ afterHash: hash(expected), afterSize: String(expected.length) })
      expect(manifest.files[0]).not.toHaveProperty('after')
      expect((await undo()).files[0].status).toBe('restored')
      expect(await readFile(target)).toEqual(baseline)
    }
  )
  it('marks absent, repeated and overlapping single-edit matches undecidable', async () => {
    const target = path.join(root, 'edit')
    await writeFile(target, 'aaa')
    for (const oldString of ['z', 'a', 'aa']) {
      const result = await service.protectWrite({
        ...call(target, oldString),
        intent: { toolName: 'Edit', input: { old_string: oldString, new_string: 'b' } }
      })
      expect(result.classification).toBe('undecidable')
    }
  })
  it.each([null, 'new-reply'] as const)('rejects disk ownership without runtime attestation %s', async (attested) => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await write(target, 'after', 'write')
    await service.markRoundFinished(round.sessionId, round.replyId)
    const manifestPath = path.join(testDir, 'snapshots/session/reply/manifest.json')
    const currentPath = path.join(testDir, 'snapshots/session/current.json')
    const manifest = await readFile(manifestPath)
    const current = await readFile(currentPath)
    BaseService.resetInstances()
    const restarted = new AgentFileSnapshotService()
    expect(await restarted.getUndoState(round.sessionId, () => attested)).toMatchObject({
      canUndo: false,
      reason: 'stale'
    })
    expect(
      await restarted.undoCurrentRound(
        { sessionId: round.sessionId, replyId: round.replyId, expectedRevision: '1' },
        () => attested
      )
    ).toMatchObject({ reason: 'stale', files: [] })
    expect(await readFile(manifestPath)).toEqual(manifest)
    expect(await readFile(currentPath)).toEqual(current)
    expect(await readFile(target, 'utf8')).toBe('after')
    const state = await restarted.getUndoState(round.sessionId, () => round.replyId)
    expect(state).toMatchObject({ canUndo: true, reason: null })
    expect(
      await restarted.undoCurrentRound(
        { sessionId: round.sessionId, replyId: round.replyId, expectedRevision: state.revision! },
        () => round.replyId
      )
    ).toMatchObject({ reason: null, files: [{ status: 'restored' }] })
    expect(await readFile(target, 'utf8')).toBe('before')
  })
  it('keeps a finished round when a queued input extension acquires the lock later', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await write(target, 'after', 'write')
    let release!: () => void
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = (
      service as unknown as { exclusive: (id: string, fn: () => Promise<void>) => Promise<void> }
    ).exclusive(round.sessionId, async () => {
      entered()
      await hold
    })
    await ready
    const extension = service.extendRoundInputs({ ...round, inputMessageIds: ['input', 'steer'] })
    const finish = service.markRoundFinished(round.sessionId, round.replyId)
    release()
    await Promise.all([locked, extension, finish])
    const state = await service.getUndoState(round.sessionId)
    expect(state).toMatchObject({ replyId: round.replyId, canUndo: true, reason: null })
    expect(
      await service.undoCurrentRound({
        sessionId: round.sessionId,
        replyId: round.replyId,
        expectedRevision: state.revision!
      })
    ).toMatchObject({ reason: null, files: [{ status: 'restored' }] })
    expect(await readFile(target, 'utf8')).toBe('before')
  })
  it.each([130, 5])('cancels an unchanged pending attempt only after 120 seconds (age %is)', async (age) => {
    const target = path.join(root, 'pending')
    const changed = path.join(root, 'changed')
    await writeFile(target, 'baseline')
    await writeFile(changed, 'before')
    await write(changed, 'after', 'written')
    await service.protectWrite(call(target, 'pending'))
    await service.markRoundFinished(round.sessionId, round.replyId)
    const manifestPath = path.join(testDir, 'snapshots/session/reply/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.files.find((file: { path: string }) => file.path === target).attempts[0].startedAt = new Date(
      Date.now() - age * 1000
    ).toISOString()
    await writeFile(manifestPath, JSON.stringify(manifest))
    const state = await service.getUndoState(round.sessionId)
    expect(state.reason).toBe(age > 120 ? null : 'pending')
    const result = await service.undoCurrentRound({
      sessionId: round.sessionId,
      replyId: round.replyId,
      expectedRevision: state.revision!
    })
    expect(result.reason).toBe(age > 120 ? null : 'pending')
    const updated = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(updated.files.find((file: { path: string }) => file.path === target).attempts[0].status).toBe(
      age > 120 ? 'cancelled' : 'pending'
    )
    expect(await readFile(changed, 'utf8')).toBe(age > 120 ? 'before' : 'after')
    expect(await readFile(target, 'utf8')).toBe('baseline')
  })
  it.each([false, true])('handles stale pending during undo when the target changed: %s', async (changed) => {
    const target = path.join(root, 'pending')
    const other = path.join(root, 'other')
    await writeFile(target, 'baseline')
    await writeFile(other, 'before')
    await write(other, 'after', 'written')
    await service.protectWrite(call(target, 'pending'))
    await service.markRoundFinished(round.sessionId, round.replyId)
    const manifestPath = path.join(testDir, 'snapshots/session/reply/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.files.find((file: { path: string }) => file.path === target).attempts[0].startedAt = new Date(
      Date.now() - 130_000
    ).toISOString()
    await writeFile(manifestPath, JSON.stringify(manifest))
    if (changed) await writeFile(target, 'user edit')
    const result = await service.undoCurrentRound({
      sessionId: round.sessionId,
      replyId: round.replyId,
      expectedRevision: manifest.revision
    })
    expect(result.reason).toBe(changed ? 'pending' : null)
    const updated = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(updated.files.find((file: { path: string }) => file.path === target).attempts[0].status).toBe(
      changed ? 'pending' : 'cancelled'
    )
    expect(await readFile(target, 'utf8')).toBe(changed ? 'user edit' : 'baseline')
    expect(await readFile(other, 'utf8')).toBe(changed ? 'after' : 'before')
  })
  it.each([130, 5])('uses the last manifest save as a conservative age for legacy pending (%is)', async (age) => {
    const target = path.join(root, 'pending')
    const other = path.join(root, 'other')
    await writeFile(target, 'baseline')
    await writeFile(other, 'before')
    await write(other, 'after', 'written')
    await service.protectWrite(call(target, 'pending'))
    await service.markRoundFinished(round.sessionId, round.replyId)
    const manifestPath = path.join(testDir, 'snapshots/session/reply/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.files.find((file: { path: string }) => file.path === target).attempts[0].startedAt
    await writeFile(manifestPath, JSON.stringify(manifest))
    const saved = new Date(Date.now() - age * 1000)
    await utimes(manifestPath, saved, saved)
    const state = await service.getUndoState(round.sessionId)
    expect(state.reason).toBe(age > 120 ? null : 'pending')
    const result = await service.undoCurrentRound({
      sessionId: round.sessionId,
      replyId: round.replyId,
      expectedRevision: state.revision!
    })
    expect(result.reason).toBe(age > 120 ? null : 'pending')
    const updated = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(updated.files.find((file: { path: string }) => file.path === target).attempts[0].status).toBe(
      age > 120 ? 'cancelled' : 'pending'
    )
    expect(await readFile(target, 'utf8')).toBe('baseline')
    expect(await readFile(other, 'utf8')).toBe(age > 120 ? 'before' : 'after')
  })
  it('reports manifest save failure and leaves the file unrestored in the manifest', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'before')
    await write(target, 'after', '1')
    const other = path.join(root, 'other')
    await writeFile(other, 'original')
    await write(other, 'changed', '2')
    await service.markRoundFinished(round.sessionId, round.replyId)
    const originalRename = fs.rename.bind(fs)
    let fail = true
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('manifest.json') && fail) {
        fail = false
        throw new Error('manifest failure')
      }
      return originalRename(from, to)
    })
    expect((await undo()).files[0].status).toBe('failed')
    spy.mockRestore()
    expect((await service.getUndoState(round.sessionId)).files[0].restoredAt).toBeNull()
    expect(await readFile(target, 'utf8')).toBe('before')
    expect(await readFile(other, 'utf8')).toBe('original')
    expect((await undo()).files.map((file) => file.status)).toEqual(['already-restored', 'already-restored'])
  })
})
