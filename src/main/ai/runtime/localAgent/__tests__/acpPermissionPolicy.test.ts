import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAcpSessionPermissionGrants,
  evaluateAcpClientTerminal,
  evaluateAcpClientWrite,
  evaluateAcpPermissionRequest,
  isPathWithinWorkspace,
  recordAcpAlwaysAllowGrant,
  selectAutoAllowPermissionOption
} from '../acpPermissionPolicy'

describe('acpPermissionPolicy', () => {
  let root: string
  let workspace: string
  let outside: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'acp-policy-'))
    workspace = path.join(root, 'workspace')
    outside = path.join(root, 'outside')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('enforces symlink-aware workspace containment and fails closed on escapes or dangling symlinks', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'secret')
    await mkdir(path.join(workspace, 'src'), { recursive: true })
    await writeFile(path.join(workspace, 'src', 'real.txt'), 'ok')
    await symlink(outside, path.join(workspace, 'escape-dir'))
    await symlink(path.join(workspace, 'src'), path.join(workspace, 'safe-link'))
    await symlink(path.join(workspace, 'does-not-exist'), path.join(workspace, 'dangling-link'))

    expect(isPathWithinWorkspace(workspace, workspace)).toBe(true)
    expect(isPathWithinWorkspace(path.join(workspace, 'src', 'real.txt'), workspace)).toBe(true)
    expect(isPathWithinWorkspace('nested/new-file.ts', workspace)).toBe(true)
    expect(isPathWithinWorkspace(path.join(workspace, 'safe-link', 'new.txt'), workspace)).toBe(true)

    expect(isPathWithinWorkspace('../outside/secret.txt', workspace)).toBe(false)
    expect(isPathWithinWorkspace(path.join(root, 'workspace-evil', 'file.ts'), workspace)).toBe(false)
    expect(isPathWithinWorkspace(path.join(workspace, 'escape-dir', 'secret.txt'), workspace)).toBe(false)
    expect(isPathWithinWorkspace(path.join(workspace, 'escape-dir', 'sub', 'new.txt'), workspace)).toBe(false)
    expect(isPathWithinWorkspace(path.join(workspace, 'dangling-link'), workspace)).toBe(false)
    expect(isPathWithinWorkspace(path.join(workspace, 'dangling-link', 'child.txt'), workspace)).toBe(false)
  })

  it('prefers allow_once over allow_always when auto-approving so CLIs do not persist host overrides', () => {
    expect(
      selectAutoAllowPermissionOption([
        { optionId: 'always', kind: 'allow_always' },
        { optionId: 'once', kind: 'allow_once' },
        { optionId: 'deny', kind: 'reject_once' }
      ])?.optionId
    ).toBe('once')

    expect(
      selectAutoAllowPermissionOption([
        { optionId: 'always', kind: 'allow_always' },
        { optionId: 'deny', kind: 'reject_once' }
      ])?.optionId
    ).toBe('always')

    expect(selectAutoAllowPermissionOption([{ optionId: 'deny', kind: 'reject_once' }])).toBeUndefined()
  })

  it('enforces permission tiers and session grants across tool kinds and client callbacks', async () => {
    await writeFile(path.join(outside, 'out.txt'), 'x')
    await symlink(outside, path.join(workspace, 'escape-dir'))
    const grants = createAcpSessionPermissionGrants()

    // bypassPermissions allows everything unconditionally
    expect(
      evaluateAcpPermissionRequest({
        mode: 'bypassPermissions',
        tool: { kind: 'execute', title: 'Run shell' },
        cwd: workspace,
        grants
      })
    ).toBe('allow')

    // Native auto mode leaves escalations to the user
    expect(
      evaluateAcpPermissionRequest({
        mode: 'auto',
        tool: { kind: 'edit', locations: [{ path: path.join(workspace, 'a.ts') }] },
        cwd: workspace,
        grants
      })
    ).toBe('ask')

    // acceptEdits allows in-workspace mutations (only with verified paths) and rejects outside/execute
    expect(
      evaluateAcpPermissionRequest({
        mode: 'acceptEdits',
        tool: { kind: 'edit', locations: [{ path: path.join(workspace, 'a.ts') }] },
        cwd: workspace,
        grants
      })
    ).toBe('allow')
    expect(
      evaluateAcpPermissionRequest({
        mode: 'acceptEdits',
        tool: { kind: 'edit' },
        cwd: workspace,
        grants
      })
    ).toBe('ask')
    expect(
      evaluateAcpPermissionRequest({
        mode: 'acceptEdits',
        tool: { kind: 'edit', locations: [{ path: path.join(workspace, 'escape-dir', 'out.txt') }] },
        cwd: workspace,
        grants
      })
    ).toBe('ask')
    expect(
      evaluateAcpPermissionRequest({
        mode: 'acceptEdits',
        tool: { kind: 'edit', rawInput: { Path: path.join(workspace, 'raw.html') } },
        cwd: workspace,
        grants
      })
    ).toBe('allow')
    expect(
      evaluateAcpPermissionRequest({
        mode: 'acceptEdits',
        tool: { kind: 'edit', rawInput: { TargetFile: path.join(outside, 'secret.txt') } },
        cwd: workspace,
        grants
      })
    ).toBe('ask')
    expect(
      evaluateAcpPermissionRequest({
        mode: 'acceptEdits',
        tool: { kind: 'execute', title: 'Run shell' },
        cwd: workspace,
        grants
      })
    ).toBe('ask')

    // Recording allow_always on mutation shares write permission in-workspace across tool names
    recordAcpAlwaysAllowGrant(grants, { kind: 'edit', title: 'Edit a.ts' })
    expect(
      evaluateAcpPermissionRequest({
        mode: 'default',
        tool: { kind: 'create', title: 'Create b.ts', locations: [{ path: path.join(workspace, 'b.ts') }] },
        cwd: workspace,
        grants
      })
    ).toBe('allow')
    expect(
      evaluateAcpClientWrite({
        mode: 'default',
        targetPath: path.join(workspace, 'c.ts'),
        cwd: workspace,
        hasExactApprovedWrite: false,
        grants
      })
    ).toBe('allow')
    expect(
      evaluateAcpClientWrite({
        mode: 'default',
        targetPath: path.join(outside, 'out.txt'),
        cwd: workspace,
        hasExactApprovedWrite: false,
        grants
      })
    ).toBe('ask')

    // Non-write/non-execute grants stay scoped by normalized tool name/title
    recordAcpAlwaysAllowGrant(grants, { kind: 'other', name: 'web_fetch', title: 'Fetch' })
    expect(
      evaluateAcpPermissionRequest({
        mode: 'default',
        tool: { kind: 'other', name: 'Web_Fetch', title: 'Other' },
        cwd: workspace,
        grants
      })
    ).toBe('allow')
    expect(
      evaluateAcpPermissionRequest({
        mode: 'default',
        tool: { kind: 'other', name: 'mcp_danger', title: 'Other' },
        cwd: workspace,
        grants
      })
    ).toBe('ask')

    // Terminal execution respects turnApprovedExecute (single execute turn) and session grant
    expect(evaluateAcpClientTerminal({ mode: 'default', grants, turnApprovedExecute: false })).toBe('ask')
    expect(evaluateAcpClientTerminal({ mode: 'default', grants, turnApprovedExecute: true })).toBe('allow')
    recordAcpAlwaysAllowGrant(grants, { kind: 'execute', title: 'Bash' })
    expect(evaluateAcpClientTerminal({ mode: 'default', grants, turnApprovedExecute: false })).toBe('allow')
  })
})
