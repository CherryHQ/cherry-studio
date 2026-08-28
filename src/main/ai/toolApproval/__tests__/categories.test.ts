import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { evaluatePermission } from '@cherrystudio/agent-permission/node'
import { afterEach, describe, expect, it } from 'vitest'

import { buildClaudePermissionCall } from '../categories'

const makeContext = (workspace: string, agentData: string, mode: 'default' | 'edit' | 'auto' | 'full' = 'edit') => ({
  mode,
  roots: { workspace, agentData },
  isDisabled: () => false,
  responder: 'stream' as const,
  turn: 'interactive' as const,
  delegated: false
})

describe('Claude permission-call classification', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  it('extracts MultiEdit paths and lets trusted edits through edit mode', async () => {
    root = await mkdtemp(join(tmpdir(), 'claude-permission-categories-'))
    const workspace = join(root, 'workspace')
    const agentData = join(root, 'agent-data')
    await mkdir(workspace)
    await mkdir(agentData)
    await writeFile(join(workspace, 'notes.txt'), 'notes')

    const call = buildClaudePermissionCall(
      'MultiEdit',
      { file_path: join(workspace, 'notes.txt'), edits: [] },
      new Set()
    )

    expect(call).toMatchObject({ category: 'edit', paths: [join(workspace, 'notes.txt')] })
    await expect(evaluatePermission(call, makeContext(workspace, agentData))).resolves.toEqual({ effect: 'allow' })
  })

  it('asks or denies MultiEdit outside trusted roots depending on responder availability', async () => {
    root = await mkdtemp(join(tmpdir(), 'claude-permission-categories-'))
    const workspace = join(root, 'workspace')
    const agentData = join(root, 'agent-data')
    const outside = join(root, 'outside')
    await mkdir(workspace)
    await mkdir(agentData)
    await mkdir(outside)
    await writeFile(join(outside, 'notes.txt'), 'notes')

    const call = buildClaudePermissionCall('MultiEdit', { file_path: join(outside, 'notes.txt') }, new Set())
    await expect(evaluatePermission(call, makeContext(workspace, agentData))).resolves.toMatchObject({
      effect: 'ask',
      ruleId: 'edit-approval'
    })
    await expect(
      evaluatePermission(call, {
        ...makeContext(workspace, agentData, 'auto'),
        responder: 'unavailable',
        turn: 'headless'
      })
    ).resolves.toMatchObject({ effect: 'deny', ruleId: 'edit-approval' })
  })

  it('keeps config mutation denied when the responder is unavailable even if turn is interactive', async () => {
    root = await mkdtemp(join(tmpdir(), 'claude-permission-categories-'))
    const workspace = join(root, 'workspace')
    const agentData = join(root, 'agent-data')
    await mkdir(workspace)
    await mkdir(agentData)

    const call = buildClaudePermissionCall('mcp__cherry-tools__config', { action: 'rename' }, new Set(['cherry-tools']))
    await expect(
      evaluatePermission(call, {
        ...makeContext(workspace, agentData, 'full'),
        responder: 'unavailable'
      })
    ).resolves.toMatchObject({ effect: 'deny', ruleId: 'headless-config-mutation' })
  })
})
