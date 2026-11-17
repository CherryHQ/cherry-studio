import { mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import {
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '@main/ai/toolApproval/builtinToolPolicy'
import { evaluateToolGuards, type ToolGuardContext, validateToolGuardRules } from '@main/ai/toolApproval/toolGuards'
import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { KB_MANAGE_TOOL_NAME } from '@shared/ai/builtinTools'

const mocks = vi.hoisted(() => ({
  checkSkillRuntimeDependencies: vi.fn<() => Promise<{ deny?: string; warning?: string }>>(),
  evaluateUserDataSqliteGuard: vi.fn<() => Promise<{ ruleId: 'user-data-sqlite-write'; reason: string } | undefined>>()
}))

vi.mock('../skillDependencies', () => ({
  SKILL_TOOL_NAME: 'Skill',
  checkSkillRuntimeDependencies: mocks.checkSkillRuntimeDependencies
}))

vi.mock('@main/ai/toolApproval/userDataSqliteGuard', () => ({
  USER_DATA_SQLITE_GUARD_REASON: 'Access to SQLite files inside Cherry Studio user data is blocked.',
  evaluateUserDataSqliteGuard: mocks.evaluateUserDataSqliteGuard
}))

import { CLAUDE_TOOL_GUARD_RULES, GLOBAL_INSTALL_PLAN_DENIAL, GLOBAL_INSTALL_UNATTENDED_DENIAL } from '../guardRules'

const INTERACTIVE = { currentTurn: 'interactive', userResponse: 'stream' } as const
const HEADLESS = { currentTurn: 'headless', userResponse: 'unavailable' } as const
const WITHOUT_HOST_TOOLS: ReadonlySet<string> = new Set(['cherry-tools', 'agent-memory', 'skills', 'mcp-manager'])
const WITH_HOST_TOOLS: ReadonlySet<string> = new Set([...WITHOUT_HOST_TOOLS, 'assistant', 'assistant-files'])
const ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES = listBuiltinToolPolicies({ approval: 'required' })
  .filter((entry) => !WITHOUT_HOST_TOOLS.has(entry.serverName))
  .map(toMcpRuntimeName)

function makeCtx(overrides: Partial<ToolGuardContext> = {}): ToolGuardContext {
  return {
    toolName: 'Bash',
    input: undefined,
    permissionMode: 'default',
    builtinRole: undefined,
    mountedServers: WITHOUT_HOST_TOOLS,
    pluginDirectories: new Map(),
    cwd: '/ws',
    agentDataPath: '/data',
    interaction: INTERACTIVE,
    isDisabled: () => false,
    ...overrides
  }
}

const evaluate = (ctx: ToolGuardContext) => evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, ctx)

describe('CLAUDE_TOOL_GUARD_RULES', () => {
  beforeEach(() => {
    mocks.checkSkillRuntimeDependencies.mockReset()
    mocks.checkSkillRuntimeDependencies.mockResolvedValue({})
    mocks.evaluateUserDataSqliteGuard.mockReset()
    mocks.evaluateUserDataSqliteGuard.mockResolvedValue(undefined)
  })

  it('is structurally valid', () => {
    expect(validateToolGuardRules(CLAUDE_TOOL_GUARD_RULES)).toEqual([])
  })

  describe('disabled-tool', () => {
    it.each(['default', 'acceptEdits', 'bypassPermissions'] as const)(
      'denies a disabled tool under %s',
      async (mode) => {
        const decision = await evaluate(
          makeCtx({ toolName: 'Bash', permissionMode: mode, isDisabled: (name) => name === 'Bash' })
        )
        expect(decision).toEqual({
          effect: 'deny',
          reason: 'The Bash tool is disabled for this agent.',
          ruleId: 'disabled-tool'
        })
      }
    )

    it('wins the fold over an approval-required ask (deny beats ask)', async () => {
      const toolName = toCherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME)
      const decision = await evaluate(makeCtx({ toolName, isDisabled: () => true }))
      expect(decision?.ruleId).toBe('disabled-tool')
      expect(decision?.effect).toBe('deny')
    })
  })

  describe('unsupported-image-read', () => {
    it.each(['default', 'acceptEdits', 'bypassPermissions'] as const)(
      'denies image reads for a text-only model under %s',
      async (mode) => {
        const decision = await evaluate(
          makeCtx({
            toolName: 'Read',
            input: { file_path: '/ws/assets/Preview.PNG' },
            permissionMode: mode,
            supportsImages: false
          })
        )

        expect(decision).toMatchObject({
          effect: 'deny',
          ruleId: 'unsupported-image-read'
        })
      }
    )

    it('allows image reads for vision models and non-image reads for text-only models', async () => {
      await expect(
        evaluate(
          makeCtx({
            toolName: 'Read',
            input: { file_path: '/ws/assets/Preview.png' },
            supportsImages: true
          })
        )
      ).resolves.toBeUndefined()
      await expect(
        evaluate(makeCtx({ toolName: 'Read', input: { file_path: '/ws/src/Game.cs' }, supportsImages: false }))
      ).resolves.toBeUndefined()
    })
  })

  describe('builtin-destructive', () => {
    it('denies destructive Bash for protected built-in agents in every mode', async () => {
      for (const mode of ['default', 'bypassPermissions'] as const) {
        const decision = await evaluate(
          makeCtx({
            builtinRole: 'assistant',
            permissionMode: mode,
            input: { command: 'rm -rf /tmp/data' }
          })
        )
        expect(decision?.ruleId).toBe('builtin-destructive')
      }
    })

    it('denies permanent-deletion MCP tools for protected built-in agents', async () => {
      const decision = await evaluate(makeCtx({ builtinRole: 'support', toolName: 'mcp__files__delete_file' }))
      expect(decision?.ruleId).toBe('builtin-destructive')
    })

    it('does not gate ordinary agents', async () => {
      await expect(evaluate(makeCtx({ input: { command: 'rm -rf /tmp/data' } }))).resolves.toBeUndefined()
    })

    it('supplies the destructive reason when Support Bash overlaps (deny beats the support ask)', async () => {
      const decision = await evaluate(
        makeCtx({
          builtinRole: 'support',
          input: { command: 'rm -rf build' }
        })
      )
      expect(decision?.ruleId).toBe('builtin-destructive')
    })
  })

  describe('global-install', () => {
    it.each(['default', 'acceptEdits', 'auto'] as const)('asks for a global install in %s', async (permissionMode) => {
      await expect(
        evaluate(makeCtx({ permissionMode, input: { command: 'npm install -g left-pad' } }))
      ).resolves.toEqual({
        effect: 'ask',
        ruleId: 'global-install',
        reason: 'Global package installation requires user approval: global JS package install (-g/--global).'
      })
    })

    it('allows Full Access and denies plan mode', async () => {
      const input = { command: 'npm install -g left-pad' }
      await expect(evaluate(makeCtx({ permissionMode: 'bypassPermissions', input }))).resolves.toBeUndefined()
      await expect(evaluate(makeCtx({ permissionMode: 'plan', input }))).resolves.toEqual({
        effect: 'deny',
        ruleId: 'global-install-plan',
        reason: GLOBAL_INSTALL_PLAN_DENIAL
      })
    })

    it('requires a responder outside Full Access', async () => {
      const ctx = { input: { command: 'npm install -g left-pad' }, interaction: HEADLESS }
      await expect(evaluate(makeCtx(ctx))).resolves.toEqual({
        effect: 'deny',
        ruleId: 'global-install',
        reason: GLOBAL_INSTALL_UNATTENDED_DENIAL
      })
      await expect(evaluate(makeCtx({ ...ctx, permissionMode: 'bypassPermissions' }))).resolves.toBeUndefined()
    })

    it.each(['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'] as const)(
      'hard-denies mise in %s',
      async (permissionMode) => {
        for (const command of ['mise use -g fd', 'npm i -g x && mise use -g fd', 'mise use -g fd && npm i -g x']) {
          await expect(evaluate(makeCtx({ permissionMode, input: { command } }))).resolves.toEqual({
            effect: 'deny',
            ruleId: 'mise-mutation',
            reason: 'Blocked: direct mise mutation (use cli_search / cli_install).'
          })
        }
      }
    )

    it('ignores project-local installs', async () => {
      await expect(evaluate(makeCtx({ input: { command: 'npm install left-pad' } }))).resolves.toBeUndefined()
    })

    it('deterministically selects the first ask when feedback also matches (assistant role)', async () => {
      const decision = await evaluate(
        makeCtx({
          builtinRole: 'assistant',
          input: { command: 'gh issue create --title x && npm install -g left-pad' }
        })
      )
      expect(decision).toMatchObject({ effect: 'ask', ruleId: 'global-install' })
    })

    it('folds a mise denial over a feedback ask', async () => {
      await expect(
        evaluate(
          makeCtx({ builtinRole: 'assistant', input: { command: 'gh issue create --title x && mise use -g fd' } })
        )
      ).resolves.toMatchObject({
        effect: 'deny',
        ruleId: 'mise-mutation'
      })
    })
  })

  describe('skill-absent-dependency', () => {
    it('denies a provably absent dependency in every mode, bypass included', async () => {
      mocks.checkSkillRuntimeDependencies.mockResolvedValue({ deny: 'its forked subagent is not installed.' })

      for (const mode of ['default', 'bypassPermissions'] as const) {
        const decision = await evaluate(
          makeCtx({ toolName: 'Skill', permissionMode: mode, input: { skill: 'parallel-web-search' } })
        )
        expect(decision).toEqual({
          effect: 'deny',
          reason: 'its forked subagent is not installed.',
          ruleId: 'skill-absent-dependency'
        })
      }
    })

    it('leaves an advisory-only result to the hook plane', async () => {
      mocks.checkSkillRuntimeDependencies.mockResolvedValue({ warning: 'may be missing runtime dependencies.' })

      await expect(evaluate(makeCtx({ toolName: 'Skill', input: { skill: 'shadcn' } }))).resolves.toBeUndefined()
    })

    it('does not run the check when the call names no skill', async () => {
      await expect(evaluate(makeCtx({ toolName: 'Skill', input: {} }))).resolves.toBeUndefined()
      expect(mocks.checkSkillRuntimeDependencies).not.toHaveBeenCalled()
    })
  })

  describe('bash-repeat-no-progress', () => {
    const loopingCtx = (run: number | undefined) => ({
      input: { command: 'curl -s http://localhost/health' },
      bashNoProgressRun: () => run
    })

    it('denies a stuck loop at the hard threshold in every mode, bypass included', async () => {
      for (const mode of ['default', 'bypassPermissions'] as const) {
        const decision = await evaluate(makeCtx({ ...loopingCtx(5), permissionMode: mode }))
        expect(decision?.ruleId).toBe('bash-repeat-no-progress')
        expect(decision?.effect).toBe('deny')
        expect(decision?.reason).toContain('5 times')
        expect(decision?.reason).toContain('byte-identical')
      }
    })

    it('leaves the soft-threshold runs to the hook-plane warning instead of denying', async () => {
      await expect(evaluate(makeCtx(loopingCtx(3)))).resolves.toBeUndefined()
      await expect(evaluate(makeCtx(loopingCtx(4)))).resolves.toBeUndefined()
    })

    it('stays silent while the run is still forming or the session has no Bash history', async () => {
      await expect(evaluate(makeCtx(loopingCtx(undefined)))).resolves.toBeUndefined()
      await expect(
        evaluate(makeCtx({ input: { command: 'curl -s http://localhost/health' } }))
      ).resolves.toBeUndefined()
    })

    it('does not gate non-Bash tools or calls without a command', async () => {
      await expect(evaluate(makeCtx({ toolName: 'Read', bashNoProgressRun: () => 5 }))).resolves.toBeUndefined()
      await expect(evaluate(makeCtx({ bashNoProgressRun: () => 5 }))).resolves.toBeUndefined()
    })
  })

  describe('interactive-headless + ask-user-question', () => {
    it('denies interactive tools with no responder in every mode', async () => {
      for (const mode of ['default', 'bypassPermissions'] as const) {
        for (const toolName of ['EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'AskUserQuestion']) {
          const decision = await evaluate(makeCtx({ toolName, permissionMode: mode, interaction: HEADLESS }))
          expect(decision?.effect).toBe('deny')
        }
      }
    })

    it('asks for AskUserQuestion in every mode — bypass cannot answer for the user', async () => {
      for (const mode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
        const decision = await evaluate(makeCtx({ toolName: 'AskUserQuestion', permissionMode: mode }))
        expect(decision).toMatchObject({
          effect: 'ask',
          ruleId: 'ask-user-question'
        })
      }
    })

    it('leaves other interactive tools alone on live turns', async () => {
      await expect(evaluate(makeCtx({ toolName: 'EnterPlanMode' }))).resolves.toBeUndefined()
    })
  })

  describe('assistant-feedback', () => {
    const feedback = { command: 'gh issue create --title "bug"' }

    it('asks for live approval on interactive turns', async () => {
      const decision = await evaluate(makeCtx({ builtinRole: 'assistant', input: feedback }))
      expect(decision?.ruleId).toBe('assistant-feedback')
      expect(decision?.effect).toBe('ask')
    })

    it('is lifted by bypassPermissions (net behavior matches the pierced ask it replaces)', async () => {
      await expect(
        evaluate(
          makeCtx({
            builtinRole: 'assistant',
            permissionMode: 'bypassPermissions',
            input: feedback
          })
        )
      ).resolves.toBeUndefined()
    })

    it('denies headless submission even under bypass', async () => {
      const decision = await evaluate(
        makeCtx({
          builtinRole: 'assistant',
          permissionMode: 'bypassPermissions',
          input: feedback,
          interaction: HEADLESS
        })
      )
      expect(decision?.ruleId).toBe('assistant-feedback')
      expect(decision?.effect).toBe('deny')
    })

    it('does not apply to other roles', async () => {
      await expect(evaluate(makeCtx({ input: feedback }))).resolves.toBeUndefined()
    })
  })

  describe('support-bash', () => {
    const supportCtx = { builtinRole: 'support' } as const

    it('asks for every non-destructive Bash call on interactive turns', async () => {
      const decision = await evaluate(makeCtx({ ...supportCtx, input: { command: 'ls -la' } }))
      expect(decision).toMatchObject({
        effect: 'ask',
        ruleId: 'support-bash'
      })
    })

    it('is lifted by bypassPermissions', async () => {
      await expect(
        evaluate(makeCtx({ ...supportCtx, permissionMode: 'bypassPermissions', input: { command: 'ls -la' } }))
      ).resolves.toBeUndefined()
    })

    it('denies headless shell use even under bypass', async () => {
      const decision = await evaluate(
        makeCtx({ ...supportCtx, permissionMode: 'bypassPermissions', input: { command: 'ls' }, interaction: HEADLESS })
      )
      expect(decision?.ruleId).toBe('support-bash')
      expect(decision?.effect).toBe('deny')
    })
  })

  describe('support-diagnostic-draft', () => {
    const toolName = 'mcp__assistant__prepare_diagnostic_report'

    it('denies the UI-backed draft tool on headless Support turns in every mode', async () => {
      for (const permissionMode of ['default', 'bypassPermissions'] as const) {
        await expect(
          evaluate(
            makeCtx({
              builtinRole: 'support',
              toolName,
              permissionMode,
              interaction: HEADLESS
            })
          )
        ).resolves.toMatchObject({ effect: 'deny', ruleId: 'support-diagnostic-draft' })
      }
    })

    it('denies the UI-backed draft tool on headless Assistant turns', async () => {
      await expect(
        evaluate(
          makeCtx({
            builtinRole: 'assistant',
            toolName,
            permissionMode: 'default',
            interaction: HEADLESS
          })
        )
      ).resolves.toMatchObject({ effect: 'deny', ruleId: 'support-diagnostic-draft' })
    })

    it('leaves the draft tool auto-approved on interactive Assistant turns', async () => {
      await expect(evaluate(makeCtx({ builtinRole: 'assistant', toolName }))).resolves.toBeUndefined()
    })

    it('leaves the draft tool auto-approved on interactive Support turns', async () => {
      await expect(evaluate(makeCtx({ builtinRole: 'support', toolName }))).resolves.toBeUndefined()
    })
  })

  describe('approval-required', () => {
    const kbManage = toCherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME)

    it.each(['default', 'acceptEdits'] as const)('asks under %s', async (mode) => {
      const decision = await evaluate(makeCtx({ toolName: kbManage, permissionMode: mode }))
      expect(decision).toEqual({
        effect: 'ask',
        reason: `The ${kbManage} tool requires per-call user approval.`,
        ruleId: 'approval-required'
      })
    })

    it('is lifted by bypassPermissions — the user opted out of per-call approval', async () => {
      await expect(
        evaluate(makeCtx({ toolName: kbManage, permissionMode: 'bypassPermissions' }))
      ).resolves.toBeUndefined()
    })

    it('denies with no responder outside Full Access', async () => {
      const decision = await evaluate(makeCtx({ toolName: kbManage, interaction: HEADLESS }))
      expect(decision?.effect).toBe('deny')
    })

    it('runs unattended under bypassPermissions', async () => {
      await expect(
        evaluate(makeCtx({ toolName: kbManage, permissionMode: 'bypassPermissions', interaction: HEADLESS }))
      ).resolves.toBeUndefined()
    })

    it('gates assistant tools only when the assistant MCP servers are mounted', async () => {
      const assistantTool = ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES[0]
      await expect(evaluate(makeCtx({ toolName: assistantTool }))).resolves.toBeUndefined()
      await expect(
        evaluate(makeCtx({ toolName: assistantTool, mountedServers: WITH_HOST_TOOLS }))
      ).resolves.toMatchObject({
        ruleId: 'approval-required'
      })
    })
  })

  describe.each([SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME])('delegation approval: %s', (name) => {
    const toolName = toCherryBuiltinRuntimeName(name)

    it.each(['auto', 'bypassPermissions'] as const)(
      'does not ask in an interactive %s turn',
      async (permissionMode) => {
        await expect(evaluate(makeCtx({ toolName, permissionMode }))).resolves.toBeUndefined()
        await expect(evaluate(makeCtx({ toolName, permissionMode, isDisabled: () => true }))).resolves.toMatchObject({
          effect: 'deny',
          ruleId: 'disabled-tool'
        })
      }
    )

    it.each(['default', 'acceptEdits', 'plan'] as const)('asks in %s', async (permissionMode) => {
      await expect(evaluate(makeCtx({ toolName, permissionMode }))).resolves.toMatchObject({ effect: 'ask' })
    })

    it.each(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const)(
      'denies unattended delegation in %s',
      async (permissionMode) => {
        for (const interaction of [
          HEADLESS,
          { ...HEADLESS, userResponse: 'stream' },
          { ...INTERACTIVE, userResponse: 'unavailable' }
        ] as const) {
          await expect(evaluate(makeCtx({ toolName, permissionMode, interaction }))).resolves.toMatchObject({
            effect: 'deny'
          })
        }
      }
    )
  })

  describe('user-data-sqlite-write', () => {
    it.each(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'] as const)(
      'enforces a policy denial under %s',
      async (permissionMode) => {
        mocks.evaluateUserDataSqliteGuard.mockResolvedValue({
          ruleId: 'user-data-sqlite-write',
          reason: 'protected SQLite'
        })

        await expect(
          evaluate(makeCtx({ toolName: 'Write', permissionMode, input: { file_path: '/user-data/app.sqlite' } }))
        ).resolves.toEqual({
          effect: 'deny',
          ruleId: 'user-data-sqlite-write',
          reason: 'Access to SQLite files inside Cherry Studio user data is blocked.'
        })
        expect(mocks.evaluateUserDataSqliteGuard).toHaveBeenCalledWith(
          expect.objectContaining({ runtime: 'claude-code', toolName: 'Write' })
        )
      }
    )
  })

  describe('workspace-escape', () => {
    let root: string
    let cwd: string
    let agentDataPath: string

    beforeAll(async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'guard-rules-'))
      cwd = path.join(root, 'workspace')
      agentDataPath = path.join(root, 'agent-data')
      await Promise.all([
        import('node:fs/promises').then((fsp) => fsp.mkdir(cwd)),
        import('node:fs/promises').then((fsp) => fsp.mkdir(agentDataPath))
      ])
    })

    afterAll(async () => {
      await rm(root, { recursive: true, force: true })
    })

    it('asks (soft) for a file-tool path outside the allowed roots', async () => {
      const decision = await evaluate(
        makeCtx({ toolName: 'Read', cwd, agentDataPath, input: { file_path: path.join(root, 'outside.txt') } })
      )
      expect(decision?.ruleId).toBe('workspace-escape')
      expect(decision?.effect).toBe('ask')
      expect(decision?.reason).toContain(cwd)
    })

    it('stays silent for paths inside the workspace or agent data directory', async () => {
      await expect(
        evaluate(makeCtx({ toolName: 'Read', cwd, agentDataPath, input: { file_path: path.join(cwd, 'a.txt') } }))
      ).resolves.toBeUndefined()
      await expect(
        evaluate(
          makeCtx({ toolName: 'Write', cwd, agentDataPath, input: { file_path: path.join(agentDataPath, 'b.txt') } })
        )
      ).resolves.toBeUndefined()
    })

    it.skipIf(process.platform === 'win32')('asks for a dangling symlink that points outside', async () => {
      const link = path.join(cwd, 'dangling-file')
      await symlink(path.join(root, 'missing.txt'), link)
      const decision = await evaluate(makeCtx({ toolName: 'Write', cwd, agentDataPath, input: { file_path: link } }))
      expect(decision?.ruleId).toBe('workspace-escape')
    })

    it('asks for a new file below a dangling directory symlink that points outside', async () => {
      const link = path.join(cwd, 'dangling-dir')
      await symlink(path.join(root, 'missing-dir'), link, process.platform === 'win32' ? 'junction' : 'dir')
      const decision = await evaluate(
        makeCtx({ toolName: 'Write', cwd, agentDataPath, input: { file_path: path.join(link, 'new.txt') } })
      )
      expect(decision?.ruleId).toBe('workspace-escape')
    })

    it('is lifted by bypassPermissions (matches the pierced ask it replaces)', async () => {
      await expect(
        evaluate(
          makeCtx({
            toolName: 'Edit',
            cwd,
            agentDataPath,
            permissionMode: 'bypassPermissions',
            input: { file_path: path.join(root, 'outside.txt') }
          })
        )
      ).resolves.toBeUndefined()
    })

    it('does not gate Bash text', async () => {
      await expect(
        evaluate(makeCtx({ cwd, agentDataPath, input: { command: `cat ${path.join(root, 'outside.txt')}` } }))
      ).resolves.toBeUndefined()
    })
  })
})

describe('Browser control permission', () => {
  it.each(['default', 'bypassPermissions'] as const)(
    'uses the persistent browser grant in %s mode',
    async (permissionMode) => {
      const pref = application.get('PreferenceService')
      await pref.set('app.browser.agent_control.enabled', true)
      const context = makeCtx({
        toolName: 'mcp__browser__click',
        mountedServers: new Set(['browser']),
        permissionMode
      })
      expect(await evaluate(context)).toBeUndefined()
      await pref.set('app.browser.agent_control.enabled', false)
      expect(await evaluate(context)).toMatchObject({ effect: 'deny' })
    }
  )
})
