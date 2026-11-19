import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { callKeyOf } from '@cherrystudio/agent-behavior'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { AgentFileSnapshotService } from '@main/ai/agentSession/AgentFileSnapshotService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { createTestBinding, scriptedModel } from '../../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { createPiBehaviorHost } from '../piBehaviorHost'

vi.mock('@application', async () => (await import('@test-mocks/main/application')).mockApplicationFactory())

const round = { sessionId: 'session', replyId: 'reply', inputMessageIds: ['input'] }
const thread = runtimeId<'thread'>('native')
const callKey = callKeyOf('call')

describe('pi file writes', () => {
  let testDir: string
  let root: string
  let service: AgentFileSnapshotService
  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'cherry-'))
    root = path.join(testDir, 'workspace')
    await mkdir(root)
    vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
    BaseService.resetInstances()
    service = new AgentFileSnapshotService()
    await service.admitRound(round)
    MockApplicationUtils.setService('AgentFileSnapshotService', service)
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getLiveSnapshotRound: (id: string) => (id === round.sessionId ? round : undefined)
    })
  })
  afterEach(async () => {
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
    BaseService.resetInstances()
    await rm(testDir, { recursive: true, force: true })
  })
  async function host(
    headless = false,
    interaction: { currentTurn: 'headless' | 'interactive'; userResponse: 'unavailable' | 'stream' } = {
      currentTurn: 'interactive',
      userResponse: 'stream'
    }
  ) {
    const binding = await createTestBinding({ stream: scriptedModel([]).model })
    return (
      await createPiBehaviorHost({
        input: { sessionId: 'session', agentId: 'agent', modelId: 'provider::model', headless },
        cwd: root,
        runtime: 'pi',
        root: () => thread,
        binding,
        model: { id: 'provider::model', providerId: 'provider', capabilities: [] } as never,
        approval: {
          sessionId: 'session',
          workspacePath: root,
          agentDataPath: root,
          additionalReadOnlyRoots: [],
          getInteractionState: () => interaction,
          getPermissionMode: () => 'auto',
          isDisabled: () => false,
          autoApprovedTools: new Set(),
          approvalRequiredTools: new Set(),
          nonBypassableApprovalTools: new Set(),
          delegationTools: new Set()
        },
        usageSessionId: async (id) => {
          if (id !== thread) throw new Error('unknown thread')
          return 'child-archive'
        },
        toolCallIdentity: async () => ({ toolCallId: 'tool' }),
        emit: () => {},
        observe: () => {}
      })
    ).host
  }
  it('uses the live interaction state when a headless connection is reused', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'contents')
    const interaction: { currentTurn: 'headless' | 'interactive'; userResponse: 'unavailable' | 'stream' } = {
      currentTurn: 'headless',
      userResponse: 'unavailable'
    }
    const h = await host(true, interaction)
    h.approvals.ask = async () => ({ kind: 'granted' })
    const args = { path: 'file', content: '' }
    const signal = new AbortController().signal
    expect((await h.fileWrites!.protect({ thread, callKey, tool: 'write', args, signal })).block).toBeTruthy()
    interaction.currentTurn = 'interactive'
    interaction.userResponse = 'stream'
    expect(await h.fileWrites!.protect({ thread, callKey: callKeyOf('second'), tool: 'write', args, signal })).toEqual(
      {}
    )
  })
  it('allows a new nested file and removes it on undo', async () => {
    const h = await host()
    const target = path.join(root, 'src/new/file.ts')
    const args = { path: 'src/new/file.ts', content: 'created' }
    expect(
      await h.fileWrites!.protect({ thread, callKey, tool: 'write', args, signal: new AbortController().signal })
    ).toEqual({})
    const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
    expect(manifest.files[0].existedBefore).toBe(false)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, 'created')
    await h.fileWrites!.settle({ thread, callKey, tool: 'write', args, isError: false })
    await service.markRoundFinished(round.sessionId, round.replyId)
    const state = await service.getUndoState(round.sessionId)
    expect(
      await service.undoCurrentRound({
        sessionId: round.sessionId,
        replyId: round.replyId,
        expectedRevision: state.revision!
      })
    ).toMatchObject({ reason: null, files: [{ status: 'removed' }] })
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each([true, false])('confirms an empty write and settles its actual state (approved: %s)', async (approved) => {
    const target = path.join(root, 'file')
    await writeFile(target, 'contents')
    const h = await host()
    let asked = 0
    h.approvals.ask = async () => {
      asked++
      return approved ? { kind: 'granted' } : { kind: 'denied' }
    }
    const args = { path: 'file', content: '' }
    const verdict = await h.fileWrites!.protect({
      thread,
      callKey,
      tool: 'write',
      args,
      signal: new AbortController().signal
    })
    expect(asked).toBe(1)
    expect(Boolean(verdict.block)).toBe(!approved)
    if (approved) await writeFile(target, '')
    await h.fileWrites!.settle({ thread, callKey, tool: 'write', args, isError: !approved })
    const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
    expect(manifest.files[0].afterSize ?? null).toBe(approved ? '0' : null)
    expect(manifest.files[0].attempts[0].status).toBe(approved ? 'written' : 'failed')
  })
  it('attributes a child write to the live reply and restores it with the round', async () => {
    const h = await host()
    const child = runtimeId<'thread'>('child')
    const target = path.join(root, 'file')
    await writeFile(target, 'original')
    const args = { path: 'file', content: 'original plus' }
    expect(
      await h.fileWrites!.protect({ thread: child, callKey, tool: 'write', args, signal: new AbortController().signal })
    ).toEqual({})
    await writeFile(target, 'original plus')
    await h.fileWrites!.settle({ thread: child, callKey, tool: 'write', args, isError: false })
    const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
    expect(manifest.files[0].attempts[0].origin).toBe('subagent')
    await service.markRoundFinished(round.sessionId, round.replyId)
    const state = await service.getUndoState(round.sessionId)
    expect(
      await service.undoCurrentRound({
        sessionId: round.sessionId,
        replyId: round.replyId,
        expectedRevision: state.revision!
      })
    ).toMatchObject({ reason: null })
    expect(await readFile(target, 'utf8')).toBe('original')
  })
  it('confirms an ambiguous edit and preserves a user save before settlement', async () => {
    const target = path.join(root, 'file')
    await writeFile(target, 'same same')
    const h = await host()
    let asked = 0
    h.approvals.ask = async () => {
      asked++
      return { kind: 'granted' }
    }
    const editKey = callKeyOf('edit')
    const args = { path: 'file', edits: [{ oldText: 'same', newText: 'other' }] }
    expect(
      await h.fileWrites!.protect({
        thread,
        callKey: editKey,
        tool: 'edit',
        args,
        signal: new AbortController().signal
      })
    ).toEqual({})
    expect(asked).toBe(1)
    await h.fileWrites!.settle({ thread, callKey: editKey, tool: 'edit', args, isError: true })
    const writeArgs = { path: 'file', content: 'same same!' }
    expect(
      await h.fileWrites!.protect({
        thread,
        callKey,
        tool: 'write',
        args: writeArgs,
        signal: new AbortController().signal
      })
    ).toEqual({})
    await writeFile(target, 'same same!')
    await writeFile(target, 'user save')
    await h.fileWrites!.settle({ thread, callKey, tool: 'write', args: writeArgs, isError: false })
    await service.markRoundFinished(round.sessionId, round.replyId)
    const state = await service.getUndoState(round.sessionId)
    expect(state).toMatchObject({ canUndo: false, reason: 'conflict' })
    expect(
      await service.undoCurrentRound({
        sessionId: round.sessionId,
        replyId: round.replyId,
        expectedRevision: state.revision!
      })
    ).toMatchObject({ reason: 'conflict', files: [{ status: 'conflict' }] })
    expect(await readFile(target, 'utf8')).toBe('user save')
  })
  it('blocks child writes without a live round and ignores shell tools', async () => {
    MockApplicationUtils.setService('AgentSessionRuntimeService', { getLiveSnapshotRound: () => undefined })
    const h = await host()
    const args = { path: 'file', content: '' }
    expect(
      await h.fileWrites!.protect({
        thread: runtimeId<'thread'>('child'),
        callKey,
        tool: 'write',
        args,
        signal: new AbortController().signal
      })
    ).toHaveProperty('block')
    expect(
      await h.fileWrites!.protect({ thread, callKey, tool: 'bash', args, signal: new AbortController().signal })
    ).toEqual({})
    await expect(stat(path.join(testDir, 'snapshots'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
