import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { callBuiltinTool, toolText } from '@main/ai/mcp/servers/__tests__/builtinMcpClient'
import { registerAutonomyTools } from '@main/ai/mcp/servers/cherryAutonomyTools'
import { buildWorktreeContext } from '@main/ai/runtime/agentPrompt'
import { findBuiltinToolPolicy } from '@main/ai/toolApproval/builtinToolPolicy'

// Catch wrong-repository adoption, lost persistence and cross-session tool writes with real Git and SQLite.
describe('Session worktree association', () => {
  const dbh = setupTestDatabase()
  let root: string
  let repository: string
  let target: string
  let sessionId: string
  let otherId: string
  function git(cwd: string, ...args: string[]) {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  function server() {
    const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
    const session = agentSessionService.getById(sessionId)
    registerAutonomyTools(server, {
      agentId: 'worktree-agent',
      sessionId,
      workspaceSource: { type: 'user', workspaceId: session.workspaceId },
      workspacePath: repository,
      trustedNotifyChannels: [],
      allowAnyOwnedNotifyChannel: false
    })
    return server
  }
  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'session-worktree-')))
    repository = path.join(root, 'repo')
    target = path.join(root, 'linked tree')
    mkdirSync(repository)
    git(repository, 'init')
    git(
      repository,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'initial'
    )
    git(repository, 'worktree', 'add', '-b', 'feature', target)
    dbh.db
      .insert(agentTable)
      .values({ id: 'worktree-agent', type: 'claude-code', name: 'Test', instructions: '', orderKey: 'a0' })
      .run()
    const workspace = agentWorkspaceService.findOrCreateByPath(repository)
    const create = () =>
      agentSessionService.create({
        agentId: 'worktree-agent',
        name: 'Test',
        workspace: { type: 'user', workspaceId: workspace.id }
      }).id
    sessionId = create()
    otherId = create()
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' })
    })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    MockApplicationUtils.resetServices()
  })

  it('persists the canonical linked target through session list reload without replacing the workspace', async () => {
    const before = agentSessionService.getById(sessionId)
    await agentSessionService.setWorktree(sessionId, '../linked tree')
    const after = agentSessionService.getById(sessionId)
    expect(after).toMatchObject({
      workspace: before.workspace,
      workspaceId: before.workspaceId,
      worktree: { path: target, branch: 'feature', available: true },
      lastActivityAt: before.lastActivityAt
    })
    expect(
      agentSessionService.listByCursor({ scope: 'ordinary' }).items.find((s) => s.id === sessionId)?.worktree
    ).toEqual(after.worktree)
    expect(agentSessionService.getById(otherId).worktree).toBeUndefined()
    expect(buildWorktreeContext(after.worktree)).toContain(JSON.stringify(target))
  })

  it('accepts detached HEAD and refreshes externally changed branch and unavailable status', async () => {
    await agentSessionService.setWorktree(sessionId, target)
    git(target, 'checkout', '--detach')
    expect(await agentSessionService.refreshWorktree(sessionId)).toMatchObject({ branch: null, available: true })
    expect(buildWorktreeContext(agentSessionService.getById(sessionId).worktree)).toContain('detached HEAD')
    git(repository, 'worktree', 'remove', target)
    expect(await agentSessionService.refreshWorktree(sessionId)).toMatchObject({ path: target, available: false })
    expect(buildWorktreeContext(agentSessionService.getById(sessionId).worktree)).toContain('Do not silently fall back')
  })

  it('rejects primary, ordinary, missing and unrelated targets without overwriting a saved association', async () => {
    await agentSessionService.setWorktree(sessionId, target)
    const before = agentSessionService.getById(sessionId).worktree
    const ordinary = path.join(root, 'ordinary')
    const foreign = path.join(root, 'foreign')
    mkdirSync(ordinary)
    mkdirSync(foreign)
    git(foreign, 'init')
    for (const input of [repository, ordinary, foreign, path.join(root, 'missing')]) {
      await expect(agentSessionService.setWorktree(sessionId, input)).rejects.toThrow()
      expect(agentSessionService.getById(sessionId).worktree).toEqual(before)
    }
  })

  it('rejects an in-flight adoption if the original workspace changes', async () => {
    const pending = agentSessionService.setWorktree(sessionId, target)
    const next = agentWorkspaceService.findOrCreateByPath(root)
    agentSessionService.setWorkspace(sessionId, { type: 'user', workspaceId: next.id })
    await expect(pending).rejects.toThrow('Session binding changed')
    expect(agentSessionService.getById(sessionId)).toMatchObject({ workspaceId: next.id, worktree: undefined })
  })

  it('clears only the calling session and never deletes the target or branch', async () => {
    const result = await callBuiltinTool(server, 'session_worktree', { action: 'associate', path: target })
    expect(result.isError, toolText(result)).not.toBe(true)
    const injection = await callBuiltinTool(server, 'session_worktree', { action: 'clear', session_id: otherId })
    expect(injection.isError).toBe(true)
    expect(agentSessionService.getById(sessionId).worktree).toBeDefined()
    await callBuiltinTool(server, 'session_worktree', { action: 'clear' })
    expect(agentSessionService.getById(sessionId).worktree).toBeUndefined()
    expect(buildWorktreeContext()).not.toContain(target)
    expect(git(target, 'branch', '--show-current')).toBe('feature')
    expect(findBuiltinToolPolicy('mcp__cherry-tools__session_worktree', new Set(['cherry-tools']))?.approval).toBe(
      'required'
    )
  })
})
