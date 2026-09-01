import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { decideDelegatedToolCall, decideToolCall, detectGlobalInstall } from '../src/policy'
import type { BridgePolicy } from '../src/protocol'

// Module-scope setup: it.each tables are built at collection time, before any beforeAll.
const workspace = mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-ws-'))
const agentData = mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-agent-'))
const outside = mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-outside-'))
writeFileSync(path.join(workspace, 'inside.txt'), 'in')
writeFileSync(path.join(agentData, 'memory.md'), 'mem')
writeFileSync(path.join(outside, 'secret.txt'), 'out')
mkdirSync(path.join(workspace, 'sub'))
// Symlink escape: lexically inside the workspace, physically outside.
symlinkSync(path.join(outside, 'secret.txt'), path.join(workspace, 'escape.txt'))

const policy = (overrides: Partial<BridgePolicy> = {}): BridgePolicy => ({
  permissionMode: 'default',
  disabledTools: [],
  allowedRoots: [workspace, agentData],
  readTools: ['read', 'read_image'],
  editTools: ['edit', 'write'],
  autoApprovedTools: [],
  approvalRequiredTools: [],
  nonBypassableApprovalTools: [],
  planSafeTools: [],
  ...overrides
})

/** Plan mode as the host pushes it: safe builtins + Cherry auto-approved bridged tools. */
const planPolicy = (overrides: Partial<BridgePolicy> = {}): BridgePolicy =>
  policy({
    permissionMode: 'plan',
    autoApprovedTools: ['subagent', 'mcp__cherry-tools__web_search'],
    planSafeTools: ['todo_write', 'exit_plan_mode', 'list_agents', 'mcp__cherry-tools__web_search'],
    ...overrides
  })

describe('decideToolCall', () => {
  it.each([
    ['default', 'bash inside workspace asks', policy(), 'bash', { command: 'ls' }, 'ask'],
    ['default', 'read inside workspace allows', policy(), 'read', { file_path: 'inside.txt' }, 'allow'],
    ['default', 'read via `path` key allows', policy(), 'read', { path: 'inside.txt' }, 'allow'],
    ['default', 'read with no path arg allows (defaults to workspace root)', policy(), 'read', {}, 'allow'],
    [
      'default',
      'read inside second root (agent data) allows',
      policy(),
      'read',
      { file_path: path.join(agentData, 'memory.md') },
      'allow'
    ],
    ['default', 'read outside asks', policy(), 'read', { file_path: path.join(outside, 'secret.txt') }, 'ask'],
    ['default', 'read of a symlink escaping the workspace asks', policy(), 'read', { file_path: 'escape.txt' }, 'ask'],
    ['default', 'read of ../ traversal out of the workspace asks', policy(), 'read', { file_path: '../x' }, 'ask'],
    ['default', 'read of a file:// URL asks (ambiguous)', policy(), 'read', { file_path: 'file:///etc/passwd' }, 'ask'],
    ['default', 'read of a non-string path asks (ambiguous)', policy(), 'read', { file_path: 42 }, 'ask'],
    [
      'default',
      'edit inside still asks (edit fast-path is acceptEdits-only)',
      policy(),
      'edit',
      { file_path: 'inside.txt' },
      'ask'
    ],
    ['default', 'mcp tool asks', policy(), 'mcp__server__tool', { x: 1 }, 'ask'],
    [
      'acceptEdits',
      'edit of an existing inside file allows',
      policy({ permissionMode: 'acceptEdits' }),
      'edit',
      { file_path: 'inside.txt' },
      'allow'
    ],
    [
      'acceptEdits',
      'write of a NEW inside file allows (nearest-existing-parent)',
      policy({ permissionMode: 'acceptEdits' }),
      'write',
      { file_path: 'sub/new/deep.txt' },
      'allow'
    ],
    [
      'acceptEdits',
      'write outside asks',
      policy({ permissionMode: 'acceptEdits' }),
      'write',
      { file_path: path.join(outside, 'new.txt') },
      'ask'
    ],
    [
      'acceptEdits',
      'write to ~ asks',
      policy({ permissionMode: 'acceptEdits' }),
      'write',
      { file_path: '~/pwned.txt' },
      'ask'
    ],
    ['acceptEdits', 'bash still asks', policy({ permissionMode: 'acceptEdits' }), 'bash', { command: 'ls' }, 'ask'],
    [
      'bypassPermissions',
      'bash allows',
      policy({ permissionMode: 'bypassPermissions' }),
      'bash',
      { command: 'rm -rf /tmp/x' },
      'allow'
    ],
    [
      'bypassPermissions',
      'mcp tool allows',
      policy({ permissionMode: 'bypassPermissions' }),
      'mcp__server__tool',
      {},
      'allow'
    ],
    [
      'bypassPermissions',
      'disabled tool still denies (disabled beats bypass)',
      policy({ permissionMode: 'bypassPermissions', disabledTools: ['bash'] }),
      'bash',
      { command: 'ls' },
      'deny'
    ],
    [
      'bypassPermissions',
      'approval-required first-party tool allows (bypass is the explicit opt-out of per-call approval)',
      policy({
        permissionMode: 'bypassPermissions',
        autoApprovedTools: ['mcp__cherry-tools__kb_manage'],
        approvalRequiredTools: ['mcp__cherry-tools__kb_manage']
      }),
      'mcp__cherry-tools__kb_manage',
      {},
      'allow'
    ],
    [
      'bypassPermissions',
      'non-bypassable delegation still asks',
      policy({
        permissionMode: 'bypassPermissions',
        approvalRequiredTools: ['mcp__cherry-tools__session_send'],
        nonBypassableApprovalTools: ['mcp__cherry-tools__session_send']
      }),
      'mcp__cherry-tools__session_send',
      {},
      'ask'
    ],
    [
      'default',
      'approval-required beats auto-approval outside bypass',
      policy({
        autoApprovedTools: ['mcp__cherry-tools__kb_manage'],
        approvalRequiredTools: ['mcp__cherry-tools__kb_manage']
      }),
      'mcp__cherry-tools__kb_manage',
      {},
      'ask'
    ],
    [
      'default',
      'auto-approved first-party tool allows',
      policy({ autoApprovedTools: ['mcp__cherry-tools__web_search'] }),
      'mcp__cherry-tools__web_search',
      {},
      'allow'
    ],
    [
      'default',
      'disabled beats first-party auto approval',
      policy({
        disabledTools: ['mcp__cherry-tools__web_search'],
        autoApprovedTools: ['mcp__cherry-tools__web_search']
      }),
      'mcp__cherry-tools__web_search',
      {},
      'deny'
    ],
    [
      'default',
      'disabled read tool denies before the fast-path',
      policy({ disabledTools: ['read'] }),
      'read',
      { file_path: 'inside.txt' },
      'deny'
    ],
    [
      'default',
      'empty allowedRoots asks even for read tools',
      policy({ allowedRoots: [] }),
      'read',
      { file_path: 'inside.txt' },
      'ask'
    ]
  ])('[%s] %s', async (_mode, _label, testPolicy, toolName, args, expected) => {
    const decision = await decideToolCall(testPolicy, toolName, args)
    expect(decision.kind).toBe(expected)
  })

  it('denies a disabled tool with an explanatory reason', async () => {
    const decision = await decideToolCall(policy({ disabledTools: ['bash'] }), 'bash', { command: 'ls' })
    expect(decision).toEqual({ kind: 'deny', reason: 'Tool "bash" is disabled for this agent.' })
  })

  // Plan mode IS the read-only guarantee — dsh's own plan mode enforces nothing.
  describe('plan mode', () => {
    it.each([
      ['contained read allows', 'read', { file_path: 'inside.txt' }, 'allow'],
      ['read outside the roots denies (never asks)', 'read', { file_path: path.join(outside, 'secret.txt') }, 'deny'],
      ['plan-safe builtin allows', 'todo_write', { todos: [] }, 'allow'],
      ['exit_plan_mode allows', 'exit_plan_mode', { plan: '# P' }, 'allow'],
      ['auto-approved bridged tool listed plan-safe allows', 'mcp__cherry-tools__web_search', {}, 'allow'],
      ['edit denies', 'edit', { file_path: 'inside.txt' }, 'deny'],
      ['write denies', 'write', { file_path: 'sub/new.txt' }, 'deny'],
      ['bash denies', 'bash', { command: 'ls' }, 'deny'],
      // The load-bearing exclusion: auto-approved does NOT imply plan-safe, or the
      // model could delegate the mutation to a child and bypass read-only.
      ['subagent denies even though auto-approved', 'subagent', { description: 'x', prompt: 'y' }, 'deny'],
      ['unknown mcp tool denies', 'mcp__server__tool', {}, 'deny']
    ])('%s', async (_label, toolName, args, expected) => {
      const decision = await decideToolCall(planPolicy(), toolName, args)
      expect(decision.kind).toBe(expected)
    })

    it('disabled still wins over plan-safe', async () => {
      const decision = await decideToolCall(planPolicy({ disabledTools: ['todo_write'] }), 'todo_write', {})
      expect(decision.kind).toBe('deny')
    })
  })
})

describe('decideDelegatedToolCall', () => {
  it('degrades ask to an explicit deny (dsh pins delegated approval to never)', async () => {
    const decision = await decideDelegatedToolCall(policy(), 'bash', { command: 'ls' })
    expect(decision.kind).toBe('deny')
    expect((decision as { reason: string }).reason).toMatch(/approval/i)
  })

  it.each([
    ['contained read still allows', policy(), 'read', { file_path: 'inside.txt' }, 'allow'],
    ['bypass still allows bash', policy({ permissionMode: 'bypassPermissions' }), 'bash', { command: 'ls' }, 'allow'],
    [
      'bypass lifts approval-required for the delegated child too (no dead-end deny)',
      policy({ permissionMode: 'bypassPermissions', approvalRequiredTools: ['mcp__cherry-tools__kb_manage'] }),
      'mcp__cherry-tools__kb_manage',
      {},
      'allow'
    ],
    [
      'non-bypassable delegation denies in the delegated child under bypass',
      policy({
        permissionMode: 'bypassPermissions',
        approvalRequiredTools: ['mcp__cherry-tools__session_send'],
        nonBypassableApprovalTools: ['mcp__cherry-tools__session_send']
      }),
      'mcp__cherry-tools__session_send',
      {},
      'deny'
    ],
    [
      'acceptEdits contained edit still allows',
      policy({ permissionMode: 'acceptEdits' }),
      'edit',
      { file_path: 'inside.txt' },
      'allow'
    ],
    ['disabled still denies', policy({ disabledTools: ['read'] }), 'read', { file_path: 'inside.txt' }, 'deny'],
    ['plan child denies mutation', planPolicy(), 'edit', { file_path: 'inside.txt' }, 'deny']
  ])('%s', async (_label, testPolicy, toolName, args, expected) => {
    const decision = await decideDelegatedToolCall(testPolicy, toolName, args)
    expect(decision.kind).toBe(expected)
  })
})

describe('detectGlobalInstall', () => {
  it.each([
    ['npm install -g typescript', 'global JS package install (-g/--global)'],
    ['ls && npm i -g x', 'global JS package install (-g/--global)'],
    ['yarn global add eslint', 'yarn global add'],
    ['uv tool install ruff', 'uv tool install (persistent global tool — use `uvx` for one-off runs)'],
    ['pip install --user requests', 'global pip install (--user/--system/--break-system-packages)'],
    ['brew install jq', 'system package-manager install'],
    ['cargo install ripgrep', 'cargo install (persistent user tool)']
  ])('flags %s', (command, reason) => {
    expect(detectGlobalInstall(command)).toBe(reason)
  })

  it.each([
    'npm install typescript',
    'bun x cowsay',
    'uvx ruff check',
    'echo npm-install-g-doc',
    'pip install requests'
  ])('allows %s', (command) => {
    expect(detectGlobalInstall(command)).toBeNull()
  })

  it('does not attribute a -g flag in one segment to a manager in another', () => {
    expect(detectGlobalInstall('npm install typescript; grep -g pattern file')).toBeNull()
  })
})
