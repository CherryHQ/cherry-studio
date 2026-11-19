import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { AgentFileSnapshotService } from '@main/ai/agentSession/AgentFileSnapshotService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { createFileWriteSnapshotHooks } from '../fileWriteSnapshot'

const round = { sessionId: 'session', replyId: 'reply', inputMessageIds: ['input'] }
describe('Claude Code file write snapshots', () => {
  let testDir: string
  let root: string
  let target: string
  let service: AgentFileSnapshotService
  let hooks: ReturnType<typeof createFileWriteSnapshotHooks>
  let approved: boolean
  let requests: number
  let interaction: { currentTurn: string; userResponse: string }
  let emitter: boolean
  let liveRound: typeof round | undefined
  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'cherry-'))
    root = path.join(testDir, 'workspace')
    await mkdir(root)
    target = path.join(root, 'file')
    await writeFile(target, 'abcdefghij')
    BaseService.resetInstances()
    service = new AgentFileSnapshotService()
    vi.spyOn(service, 'workspaceRoots').mockResolvedValue([])
    vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
    await service.admitRound(round)
    liveRound = round
    approved = true
    requests = 0
    emitter = true
    interaction = { currentTurn: 'interactive', userResponse: 'stream' }
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'AgentFileSnapshotService') return service
      if (name === 'AgentSessionRuntimeService')
        return { getLiveSnapshotRound: () => liveRound, getInteractionState: () => interaction }
      if (name === 'ClaudeCodeSessionStateService')
        return {
          peekToolApprovalEmitter: () =>
            emitter
              ? {
                  emit: ({ approvalId }: { approvalId: string }) => {
                    requests++
                    toolApprovalRegistry.dispatch(approvalId, { approved })
                  }
                }
              : undefined
        }
      throw new Error(name)
    }) as typeof application.get)
    hooks = createFileWriteSnapshotHooks(round.sessionId, root)
  })
  afterEach(async () => {
    toolApprovalRegistry.clear()
    vi.restoreAllMocks()
    BaseService.resetInstances()
    await rm(testDir, { recursive: true, force: true })
  })
  async function pre(tool: string, toolInput: object, id = 'call') {
    return hooks.pre({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput } as never, id, {
      signal: new AbortController().signal
    })
  }
  const decision = (result: unknown) =>
    (result as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision
  it('denies an empty write when rejected and retains the unchanged baseline', async () => {
    approved = false
    expect(decision(await pre('Write', { file_path: target, content: '' }))).toBe('deny')
    expect(requests).toBe(1)
    expect(await readFile(target, 'utf8')).toBe('abcdefghij')
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect((await service.getUndoState(round.sessionId)).canUndo).toBe(true)
  })
  it('leaves permission to the SDK after approval and records the actual post-write state', async () => {
    expect(await pre('Write', { file_path: target, content: '' })).toEqual({})
    expect(requests).toBe(1)
    expect((await service.getUndoState(round.sessionId)).canUndo).toBe(false)
    await writeFile(target, '')
    await hooks.post({ hook_event_name: 'PostToolUse', tool_name: 'Write' } as never, 'call', {} as never)
    const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
    expect(manifest.files[0].afterSize).toBe('0')
    expect(manifest.files[0].attempts[0].status).toBe('written')
  })
  it('asks for a 60 percent deletion but not a 10 percent deletion', async () => {
    expect(await pre('Write', { file_path: target, content: 'abcdefghi' }, 'one')).toEqual({})
    expect(requests).toBe(0)
    await pre('Write', { file_path: target, content: 'abcd' }, 'two')
    expect(requests).toBe(1)
  })
  it('settles failed writes', async () => {
    await pre('Write', { file_path: target, content: 'abcdefghi' })
    await hooks.post({ hook_event_name: 'PostToolUseFailure', tool_name: 'Write' } as never, 'call', {} as never)
    const manifest = JSON.parse(await readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'), 'utf8'))
    expect(manifest.files[0].attempts[0].status).toBe('failed')
  })
  it('passes without a live round and creates no snapshot', async () => {
    liveRound = undefined
    expect(await pre('Write', { file_path: target, content: '' })).toEqual({})
    expect(requests).toBe(0)
    await expect(readFile(path.join(testDir, 'snapshots/session/reply/manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
  it('denies if snapshot state is missing while the runtime round remains live', async () => {
    await service.markRoundFinished(round.sessionId, round.replyId)
    expect(decision(await pre('Write', { file_path: target, content: 'data' }))).toBe('deny')
  })
  it('denies if snapshot protection fails', async () => {
    vi.spyOn(service, 'protectWrite').mockRejectedValue(new Error('failure'))
    expect(decision(await pre('Write', { file_path: target, content: '' }))).toBe('deny')
  })
  it('asks before Edit replace_all empties the file', async () => {
    await pre('Edit', { file_path: target, old_string: 'abcdefghij', new_string: '', replace_all: true })
    expect(requests).toBe(1)
  })
  it('confirms an ambiguous edit and preserves a user save before the post hook', async () => {
    await writeFile(target, 'same same')
    await pre('Edit', { file_path: target, old_string: 'same', new_string: 'other' }, 'ambiguous')
    expect(requests).toBe(1)
    await hooks.post({ hook_event_name: 'PostToolUseFailure', tool_name: 'Edit' } as never, 'ambiguous', {} as never)
    await pre('Write', { file_path: target, content: 'same same!' }, 'write')
    await writeFile(target, 'same same!')
    await writeFile(target, 'user save')
    await hooks.post({ hook_event_name: 'PostToolUse', tool_name: 'Write' } as never, 'write', {} as never)
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
  it('denies dangerous writes when headless or no emitter is available', async () => {
    interaction = { currentTurn: 'headless', userResponse: 'unavailable' }
    expect(decision(await pre('Write', { file_path: target, content: '' }, 'one'))).toBe('deny')
    interaction = { currentTurn: 'interactive', userResponse: 'stream' }
    emitter = false
    expect(decision(await pre('Write', { file_path: target, content: '' }, 'two'))).toBe('deny')
  })
  it('asks before emptying binary data and before an undecidable notebook edit', async () => {
    await writeFile(target, Buffer.from([0, 255, 1]))
    await pre('Write', { file_path: target, content: '' }, 'binary')
    expect(requests).toBe(1)
    await pre('NotebookEdit', { notebook_path: target }, 'notebook')
    expect(requests).toBe(2)
  })
  it('settles a rejected attempt before a later successful write is undone', async () => {
    approved = false
    await pre('Write', { file_path: target, content: '' }, 'rejected')
    approved = true
    await pre('Write', { file_path: target, content: 'abcdefghij!' }, 'success')
    await writeFile(target, 'abcdefghij!')
    await hooks.post({ hook_event_name: 'PostToolUse', tool_name: 'Write' } as never, 'success', {} as never)
    await service.markRoundFinished(round.sessionId, round.replyId)
    const state = await service.getUndoState(round.sessionId)
    expect(
      (
        await service.undoCurrentRound({
          sessionId: round.sessionId,
          replyId: round.replyId,
          expectedRevision: state.revision!
        })
      ).files[0].status
    ).toBe('restored')
    expect(await readFile(target, 'utf8')).toBe('abcdefghij')
  })
  it('ignores other tools without touching the snapshot service', async () => {
    const spy = vi.spyOn(service, 'protectWrite')
    expect(await pre('Bash', { command: 'true' })).toEqual({})
    expect(spy).not.toHaveBeenCalled()
  })
})
