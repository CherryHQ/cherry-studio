import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '@main/ai/toolApproval/builtinToolPolicy'
import { evaluateToolGuards, type ToolGuardContext, validateToolGuardRules } from '@main/ai/toolApproval/toolGuards'
import { SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { KB_MANAGE_TOOL_NAME } from '@shared/ai/builtinTools'

const mocks = vi.hoisted(() => ({
  checkSkillRuntimeDependencies: vi.fn<() => Promise<{ deny?: string; warning?: string }>>()
}))

vi.mock('../skillDependencies', () => ({
  SKILL_TOOL_NAME: 'Skill',
  checkSkillRuntimeDependencies: mocks.checkSkillRuntimeDependencies
}))

import { approvalRequiredRuntimeNames, CLAUDE_TOOL_GUARD_RULES, HEADLESS_INTERACTIVE_TOOL_DENIAL } from '../guardRules'

const INTERACTIVE = { currentTurn: 'interactive', userResponse: 'stream' } as const
const HEADLESS = { currentTurn: 'headless', userResponse: 'unavailable' } as const
const WITHOUT_HOST_TOOLS: ReadonlySet<string> = new Set(['cherry-tools', 'agent-memory', 'skills', 'mcp-manager'])
const WITH_HOST_TOOLS: ReadonlySet<string> = new Set([...WITHOUT_HOST_TOOLS, 'assistant', 'assistant-files'])
const NON_ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES = listBuiltinToolPolicies({
  approval: 'required',
  mountedServers: WITHOUT_HOST_TOOLS
}).map(toMcpRuntimeName)
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
  })

  it('is structurally valid', () => {
    expect(validateToolGuardRules(CLAUDE_TOOL_GUARD_RULES)).toEqual([])
  })

  it('derives the per-call approval boundary from policy entries and mounted servers', () => {
    expect(approvalRequiredRuntimeNames(WITHOUT_HOST_TOOLS)).toEqual(NON_ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES)
    expect(approvalRequiredRuntimeNames(WITH_HOST_TOOLS)).toEqual([
      ...NON_ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES,
      ...ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES
    ])
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

        expect(decision).toEqual({
          effect: 'deny',
          reason:
            'The selected model does not support image input, so Read cannot open /ws/assets/Preview.PNG. Use a vision-capable model or inspect the file through a text-only alternative.',
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
        expect(decision?.reason).toContain('permanent file deletion')
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
    it('denies a global install in every mode, bypass included', async () => {
      for (const mode of ['default', 'bypassPermissions'] as const) {
        const decision = await evaluate(
          makeCtx({ permissionMode: mode, input: { command: 'npm install -g left-pad' } })
        )
        expect(decision?.ruleId).toBe('global-install')
        expect(decision?.reason).toContain('cross-agent dependency pollution')
      }
    })

    it('ignores project-local installs', async () => {
      await expect(evaluate(makeCtx({ input: { command: 'npm install left-pad' } }))).resolves.toBeUndefined()
    })

    it('wins the fold when a feedback command also matches (assistant role)', async () => {
      const decision = await evaluate(
        makeCtx({
          builtinRole: 'assistant',
          input: { command: 'gh issue create --title x && npm install -g left-pad' }
        })
      )
      expect(decision?.ruleId).toBe('global-install')
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

  describe('headless-config-mutation', () => {
    const configTool = toCherryBuiltinRuntimeName('config')

    it('denies mutating actions on headless turns, bypass included', async () => {
      for (const mode of ['default', 'bypassPermissions'] as const) {
        const decision = await evaluate(
          makeCtx({
            toolName: configTool,
            permissionMode: mode,
            input: { action: 'add_channel' },
            interaction: { currentTurn: 'headless', userResponse: 'stream' }
          })
        )
        expect(decision?.ruleId).toBe('headless-config-mutation')
      }
    })

    it('leaves reads and interactive mutations alone', async () => {
      await expect(
        evaluate(
          makeCtx({
            toolName: configTool,
            input: { action: 'status' },
            interaction: { currentTurn: 'headless', userResponse: 'stream' }
          })
        )
      ).resolves.toBeUndefined()
      await expect(
        evaluate(makeCtx({ toolName: configTool, input: { action: 'add_channel' } }))
      ).resolves.toBeUndefined()
    })
  })

  describe('skill-install', () => {
    const install = 'mcp__skills__install_skill'

    it('denies headless installation outside bypass', async () => {
      const decision = await evaluate(
        makeCtx({ toolName: install, interaction: { currentTurn: 'headless', userResponse: 'stream' } })
      )
      expect(decision?.ruleId).toBe('skill-install')
    })

    it('lifts the headless deny under bypassPermissions (explicit unattended opt-in)', async () => {
      await expect(
        evaluate(
          makeCtx({
            toolName: install,
            permissionMode: 'bypassPermissions',
            interaction: { currentTurn: 'headless', userResponse: 'stream' }
          })
        )
      ).resolves.toBeUndefined()
    })

    it('does not gate interactive installation (canUseTool handles it)', async () => {
      await expect(evaluate(makeCtx({ toolName: install }))).resolves.toBeUndefined()
    })
  })

  describe('interactive-headless + ask-user-question', () => {
    it('denies interactive tools with no responder in every mode', async () => {
      for (const mode of ['default', 'bypassPermissions'] as const) {
        for (const toolName of ['EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'AskUserQuestion']) {
          const decision = await evaluate(makeCtx({ toolName, permissionMode: mode, interaction: HEADLESS }))
          expect(decision?.effect).toBe('deny')
          expect(decision?.reason).toBe(HEADLESS_INTERACTIVE_TOOL_DENIAL)
        }
      }
    })

    it('asks for AskUserQuestion in every mode — bypass cannot answer for the user', async () => {
      for (const mode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
        const decision = await evaluate(makeCtx({ toolName: 'AskUserQuestion', permissionMode: mode }))
        expect(decision).toEqual({
          effect: 'ask',
          reason: 'AskUserQuestion requires a live user response.',
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
      expect(decision).toEqual({
        effect: 'ask',
        reason: 'Cherry Support shell commands require live per-call user approval.',
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
      expect(decision?.reason).toBe(HEADLESS_INTERACTIVE_TOOL_DENIAL)
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

  describe('non-bypassable-approval', () => {
    const sessionSend = toCherryBuiltinRuntimeName(SESSION_SEND_TOOL_NAME)

    it('requires live approval under bypassPermissions', async () => {
      await expect(
        evaluate(makeCtx({ toolName: sessionSend, permissionMode: 'bypassPermissions' }))
      ).resolves.toMatchObject({ effect: 'ask', ruleId: 'non-bypassable-approval' })
    })

    it('denies an unattended delegation under bypassPermissions', async () => {
      await expect(
        evaluate(makeCtx({ toolName: sessionSend, permissionMode: 'bypassPermissions', interaction: HEADLESS }))
      ).resolves.toMatchObject({ effect: 'deny', ruleId: 'non-bypassable-approval' })
    })
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
