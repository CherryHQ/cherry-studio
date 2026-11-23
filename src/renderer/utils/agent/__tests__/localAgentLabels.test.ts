import { createInstance } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import zh from '@renderer/i18n/locales/zh-cn.json'
import { reasoningEffortLabel } from '@renderer/utils/reasoning'
import type { LocalAgentConfigOption } from '@shared/ai/localAgent'

import {
  findLocalDefaultNonPlanOption,
  findLocalPermissionConfigOption,
  findLocalPlanModeOption,
  getLocalOptionRiskLevel,
  isHighRiskLocalOption,
  isLocalThoughtConfigOption,
  isUnifiedLocalPermissionMode,
  localAgentConfigOptions,
  localAgentModeOptions,
  resolveUnifiedLocalPermissionModes
} from '../localAgentLabels'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'zh', resources: { en: { translation: en }, zh: { translation: zh } }, keySeparator: false })
})

describe('installed agent translations', () => {
  it('translates canonical reasoning descriptions and groups without promoted controls', () => {
    const option: LocalAgentConfigOption = {
      id: 'effort',
      name: 'Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: 'medium',
      description: 'Available effort levels for this model',
      options: [
        {
          group: 'native-levels',
          name: 'Thinking levels',
          options: [
            { value: 'medium', name: 'Medium' },
            { value: 'custom', name: 'Project reasoning', description: 'Project policy' }
          ]
        }
      ]
    }
    expect(localAgentConfigOptions([option], 'opencode', i18n.t)).toEqual([
      {
        ...option,
        name: '思考强度',
        description: '此模型可用的思考强度档位',
        options: [
          {
            group: 'native-levels',
            name: '思考强度',
            options: [
              { value: 'medium', name: '中' },
              { value: 'custom', name: 'Project reasoning', description: 'Project policy' }
            ]
          }
        ]
      }
    ])
    expect(localAgentConfigOptions([option], 'opencode', i18n.getFixedT('en'))[0]).toMatchObject({
      name: 'Reasoning effort',
      description: 'Available effort levels for this model',
      options: [{ group: 'native-levels', name: 'Reasoning effort' }]
    })
    expect(option.name).toBe('Effort')
  })

  it('preserves native model names, model groups and unknown configuration text', () => {
    const options: LocalAgentConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'native-balanced',
        description: 'Select the model for this session',
        options: [
          {
            group: 'native',
            name: 'Thinking levels',
            options: [{ value: 'native-balanced', name: 'Balanced', description: 'Project model' }]
          }
        ]
      },
      {
        id: 'custom',
        name: 'Project setting',
        type: 'select',
        currentValue: 'project',
        description: 'Project policy',
        options: [{ group: 'project', name: 'Project tiers', options: [{ value: 'project', name: 'Project choice' }] }]
      }
    ]
    expect(localAgentConfigOptions(options, undefined, i18n.t)).toEqual([
      { ...options[0], name: '模型', description: '选择当前会话使用的模型' },
      options[1]
    ])
  })

  it.each([
    ['antigravity-acp', 'Auto Edit', 'Auto-approve file edit tools', '自动批准文件编辑工具。'],
    [
      'copilot',
      'Autopilot',
      'Autonomous mode that enables allow-all and runs until task completion without user interaction (experimental)',
      '允许所有操作，无需用户交互，持续运行直到任务完成（实验性）。'
    ],
    ['cursor', 'Agent', 'Full agent capabilities with tool access', '提供完整的智能体能力，可使用工具。'],
    ['opencode', 'build', 'Plan mode. Disallows all edit tools.', '规划模式，禁止使用所有编辑工具。']
  ])(
    'translates %s without changing native values or other agents’ semantics',
    (preset, name, description, expected) => {
      const mode = { id: 'mode', currentValue: 'native-id', options: [{ value: 'native-id', name, description }] }
      const [translated] = localAgentModeOptions(mode, i18n.t, preset)
      expect(translated.description).toBe(expected)
      expect(translated.name).not.toBe(name)
      expect(translated.value).toBe('native-id')
      expect(localAgentModeOptions(mode, i18n.t, 'custom-agent')).toEqual(mode.options)
      expect(mode.options[0].description).toBe(description)
    }
  )

  it.each([
    ['code', 'The default agent. Executes tools based on configured permissions.', '编程', '根据配置的权限执行工具。'],
    ['Always Ask', 'Prompts for permission on first use of each tool', '始终询问', '首次使用每个工具时请求授权'],
    ['Delegate', 'Permissions managed by parent session', '委派', '权限由父会话管理'],
    ['My custom mode', 'Project-specific behavior', 'My custom mode', 'Project-specific behavior']
  ])('translates known mode %s without changing native values', (name, description, label, detail) => {
    expect(
      localAgentModeOptions(
        { id: 'mode', currentValue: 'native-id', options: [{ value: 'native-id', name, description }] },
        i18n.t
      )
    ).toEqual([{ value: 'native-id', name: label, description: detail }])
  })

  it('scopes CodeBuddy config translations to its preset and preserves custom options', () => {
    const options: LocalAgentConfigOption[] = [
      {
        id: 'sandbox',
        name: 'Sandbox',
        type: 'select',
        currentValue: 'false',
        description: 'Run shell commands inside the sandbox-cli isolation layer',
        options: [
          {
            value: 'true',
            name: 'Sandbox Environment',
            description: 'Bash/PowerShell commands run inside the sandbox and require escalation to touch the host'
          },
          {
            value: 'false',
            name: 'Local Environment',
            description: 'Commands run with full user permissions (no sandbox isolation)'
          },
          { value: 'custom', name: 'Custom environment', description: 'Project policy' }
        ]
      }
    ]
    expect(localAgentConfigOptions(options, 'codebuddy-code', i18n.t)).toEqual([
      {
        ...options[0],
        name: '沙箱',
        description: '在 sandbox-cli 隔离环境中执行 Shell 命令',
        options: [
          {
            value: 'true',
            name: '沙箱环境',
            description: '在沙箱中执行 Bash／PowerShell 命令；访问宿主机需要提权授权。'
          },
          { value: 'false', name: '本机环境', description: '以用户的完整权限执行命令，不使用沙箱隔离。' },
          { value: 'custom', name: 'Custom environment', description: 'Project policy' }
        ]
      }
    ])
    expect(localAgentConfigOptions(options, 'custom-agent', i18n.t)).toEqual(options)
  })

  it('keeps unknown descriptions intact even inside a recognized mode', () => {
    const mode = {
      id: 'mode',
      currentValue: 'agent',
      options: [{ value: 'agent', name: 'Agent', description: 'Custom tool policy' }]
    }
    expect(localAgentModeOptions(mode, i18n.t, 'cursor')[0]).toEqual({
      value: 'agent',
      name: '智能体',
      description: 'Custom tool policy'
    })
  })

  it('translates Pi thinking off in both protocol presentations without altering the mode ID', () => {
    const mode = { id: 'legacy-mode', currentValue: 'off', options: [{ value: 'off', name: 'Thinking: off' }] }
    expect(localAgentModeOptions(mode, i18n.t, 'pi-acp')[0]).toEqual({
      value: 'off',
      name: i18n.t('assistants.settings.reasoning_effort.off')
    })
    expect(reasoningEffortLabel('off', i18n.t, 'Thinking: off')).toBe(
      i18n.t('assistants.settings.reasoning_effort.off')
    )
    expect(reasoningEffortLabel('custom', i18n.t, 'Project thinking')).toBe('Project thinking')
    expect(reasoningEffortLabel('on', i18n.t, 'On')).toBe(i18n.t('local_agents.thinking_on'))
    expect(reasoningEffortLabel('on', i18n.t, 'on')).toBe(i18n.t('local_agents.thinking_on'))
    expect(reasoningEffortLabel('enabled', i18n.t, 'On (default)')).toBe(i18n.t('local_agents.thinking_on_default'))
  })

  it('localizes Copilot approval choices while preserving string values and custom choices', () => {
    const options: LocalAgentConfigOption[] = [
      {
        id: 'allow_all',
        name: 'Allow All',
        type: 'select',
        currentValue: 'off',
        options: [
          { value: 'on', name: 'On', description: 'Automatically approve all tool, path, and URL requests' },
          { value: 'off', name: 'Off', description: 'Require approval for tool, path, and URL requests' },
          { value: 'project', name: 'Project policy' }
        ]
      }
    ]
    expect(localAgentConfigOptions(options, 'copilot', i18n.t)[0]).toEqual({
      ...options[0],
      name: '允许所有操作',
      options: [
        { value: 'on', name: '已启用', description: '自动批准所有工具、路径和 URL 请求。' },
        { value: 'off', name: '已禁用', description: '工具、路径和 URL 请求都需要批准。' },
        { value: 'project', name: 'Project policy' }
      ]
    })
    expect(localAgentConfigOptions(options, 'custom-agent', i18n.t)).toEqual(options)
    expect(options[0].name).toBe('Allow All')
  })

  it('translates Codex read-only/workspace modes and detects high-risk permission options', () => {
    const mode = {
      id: 'codex-mode',
      currentValue: 'workspace',
      options: [
        { value: 'readOnly', name: 'Read Only' },
        { value: 'workspace', name: 'Workspace' },
        { value: 'fullAccess', name: 'Full Access' }
      ]
    }
    expect(localAgentModeOptions(mode, i18n.t).map((option) => option.name)).toEqual([
      '只读',
      '工作区',
      '完全访问（高风险）'
    ])
    expect(localAgentModeOptions(mode, i18n.getFixedT('en')).map((option) => option.name)).toEqual([
      'Read Only',
      'Workspace',
      'Full Access (High Risk)'
    ])

    expect(isHighRiskLocalOption({ kind: 'mode', optionId: 'mode', value: 'yolo', name: 'YOLO' })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'mode', optionId: 'mode', value: 'autopilot', name: 'Autopilot' })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'mode', optionId: 'mode', value: 'danger-full-access' })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'mode', optionId: 'mode', value: 'workspace', name: 'Workspace' })).toBe(false)

    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'allow_all', value: true })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'allow_all', value: 'on' })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'allow_all', value: false })).toBe(false)
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'allow_all', value: 'off' })).toBe(false)

    expect(
      isHighRiskLocalOption({ kind: 'config', optionId: 'sandbox', value: 'false', name: 'Local Environment' })
    ).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'sandbox', value: false })).toBe(true)
    expect(
      isHighRiskLocalOption({ kind: 'config', optionId: 'sandbox', value: 'true', name: 'Sandbox Environment' })
    ).toBe(false)

    expect(getLocalOptionRiskLevel({ kind: 'mode', optionId: 'mode', value: 'plan', name: 'Plan' })).toBe('readonly')
    expect(getLocalOptionRiskLevel({ kind: 'mode', optionId: 'mode', value: 'readOnly', name: 'Read Only' })).toBe(
      'readonly'
    )
    expect(
      getLocalOptionRiskLevel({ kind: 'mode', optionId: 'mode', value: 'acceptEdits', name: 'Accept Edits' })
    ).toBe('auto_edit')
    expect(getLocalOptionRiskLevel({ kind: 'mode', optionId: 'mode', value: 'workspace', name: 'Workspace' })).toBe(
      'auto_edit'
    )
    expect(getLocalOptionRiskLevel({ kind: 'mode', optionId: 'mode', value: 'default', name: 'Default' })).toBe('ask')
    expect(getLocalOptionRiskLevel({ kind: 'mode', optionId: 'mode', value: 'yolo', name: 'YOLO' })).toBe('full_access')

    const codexMode = {
      id: 'codex-mode',
      currentValue: 'fullAccess',
      options: [
        { value: 'fullAccess', name: 'Full Access' },
        { value: 'readOnly', name: 'Read Only' },
        { value: 'workspace', name: 'Workspace' }
      ]
    }
    expect(findLocalPlanModeOption(codexMode)?.value).toBe('readOnly')
    expect(findLocalDefaultNonPlanOption(codexMode, 'readOnly')?.value).toBe('workspace')

    const riskyOnlyMode = {
      id: 'mode',
      currentValue: 'plan',
      options: [
        { value: 'plan', name: 'Plan' },
        { value: 'yolo', name: 'YOLO' }
      ]
    }
    expect(findLocalDefaultNonPlanOption(riskyOnlyMode, 'plan')).toBeUndefined()

    const localized = localAgentModeOptions(
      {
        id: 'mode',
        currentValue: 'build',
        options: [
          { value: 'build', name: 'build' },
          { value: 'yolo', name: 'yolo' }
        ]
      },
      i18n.t
    )
    expect(localized.find((option) => option.value === 'yolo')?.name).toBe(
      zh['code.adv.permission_modes.bypass_high_risk']
    )
    const qwenLocalized = localAgentModeOptions(
      {
        id: 'mode',
        currentValue: 'auto_edit',
        options: [{ value: 'auto_edit', name: 'Auto Edit' }]
      },
      i18n.t,
      'qwen'
    )
    expect(qwenLocalized[0]?.name).toBe(zh['code.adv.permission_modes.auto_edit'])
  })

  it('projects agent-specific permission modes into canonical tiers with capability filtering', () => {
    const claude = resolveUnifiedLocalPermissionModes(
      {
        id: 'claude-mode',
        currentValue: 'default',
        options: [
          { value: 'bypassPermissions', name: 'Bypass Permissions' },
          { value: 'auto', name: 'Auto' },
          { value: 'default', name: 'Default' },
          { value: 'plan', name: 'Plan' },
          { value: 'acceptEdits', name: 'Accept Edits' }
        ]
      },
      i18n.t,
      'claude'
    )
    expect(claude?.currentCanonicalMode).toBe('default')
    expect(claude?.options.map((o) => [o.canonicalMode, o.value, o.name, o.dangerous])).toEqual([
      ['plan', 'plan', zh['agent.settings.tooling.permissionMode.plan.title'], false],
      ['default', 'default', zh['agent.settings.tooling.permissionMode.default.title'], false],
      ['acceptEdits', 'acceptEdits', zh['agent.settings.tooling.permissionMode.acceptEdits.title'], false],
      ['auto', 'auto', zh['agent.settings.tooling.permissionMode.auto.title'], false],
      [
        'bypassPermissions',
        'bypassPermissions',
        zh['agent.settings.tooling.permissionMode.bypassPermissions.title'],
        true
      ]
    ])

    const codex = resolveUnifiedLocalPermissionModes(
      {
        id: 'codex-mode',
        currentValue: 'workspace',
        options: [
          { value: 'readOnly', name: 'Read Only' },
          { value: 'workspace', name: 'Workspace' },
          { value: 'fullAccess', name: 'Full Access' }
        ]
      },
      i18n.t,
      'codex'
    )
    expect(codex?.currentCanonicalMode).toBe('acceptEdits')
    expect(codex?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['plan', 'readOnly'],
      ['acceptEdits', 'workspace'],
      ['bypassPermissions', 'fullAccess']
    ])

    const dsh = resolveUnifiedLocalPermissionModes(
      {
        id: 'dsh-mode',
        currentValue: 'workspace-write',
        options: [
          { value: 'read-only', name: 'Read Only' },
          { value: 'workspace-write', name: 'Workspace' },
          { value: 'danger-full-access', name: 'Full Access' }
        ]
      },
      i18n.t,
      'deepseek-harness'
    )
    expect(dsh?.currentCanonicalMode).toBe('acceptEdits')
    expect(dsh?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['plan', 'read-only'],
      ['acceptEdits', 'workspace-write'],
      ['bypassPermissions', 'danger-full-access']
    ])

    // ZCode deduplicates build + edit into acceptEdits, preserving active 'build' when selected.
    const zcodeBuild = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'build',
        options: [
          { value: 'plan', name: 'plan' },
          { value: 'build', name: 'build' },
          { value: 'edit', name: 'edit' },
          { value: 'guarded', name: 'guarded' },
          { value: 'yolo', name: 'yolo' }
        ]
      },
      i18n.t,
      'zcode'
    )
    expect(zcodeBuild?.currentCanonicalMode).toBe('acceptEdits')
    expect(zcodeBuild?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['plan', 'plan'],
      ['default', 'guarded'],
      ['acceptEdits', 'build'],
      ['bypassPermissions', 'yolo']
    ])

    // Codebuddy omits unmapped niche modes (dontAsk / delegate) and preserves the 5 canonical tiers.
    const codebuddy = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'default',
        options: [
          { value: 'default', name: 'Default' },
          { value: 'acceptEdits', name: 'Accept Edits' },
          { value: 'plan', name: 'Plan' },
          { value: 'auto', name: 'Auto' },
          { value: 'dontAsk', name: "Don't Ask" },
          { value: 'bypassPermissions', name: 'Bypass Permissions' },
          { value: 'delegate', name: 'Delegate' }
        ]
      },
      i18n.t,
      'codebuddy-code'
    )
    expect(codebuddy?.options.map((o) => o.canonicalMode)).toEqual([
      'plan',
      'default',
      'acceptEdits',
      'auto',
      'bypassPermissions'
    ])

    // Preset overrides for `agent`: Copilot maps to 'default', Cursor maps to 'acceptEdits'.
    const copilot = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'agent',
        options: [
          { value: 'agent', name: 'Agent' },
          { value: 'plan', name: 'Plan' },
          { value: 'autopilot', name: 'Autopilot' }
        ]
      },
      i18n.t,
      'copilot'
    )
    expect(copilot?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['plan', 'plan'],
      ['default', 'agent'],
      ['bypassPermissions', 'autopilot']
    ])

    const cursor = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'agent',
        options: [
          { value: 'agent', name: 'Agent' },
          { value: 'plan', name: 'Plan' },
          { value: 'ask', name: 'Ask' }
        ]
      },
      i18n.t,
      'cursor'
    )
    expect(cursor?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['plan', 'plan'],
      ['acceptEdits', 'agent']
    ])

    // Pi uses ACP mode for thinking effort rather than permissions.
    const piMode = {
      id: 'mode',
      currentValue: 'medium',
      options: [
        { value: 'off', name: 'Thinking: off' },
        { value: 'medium', name: 'Thinking: medium' }
      ]
    }
    expect(isUnifiedLocalPermissionMode(piMode, 'pi-acp')).toBe(false)
    expect(resolveUnifiedLocalPermissionModes(piMode, i18n.t, 'pi-acp')).toBeUndefined()

    // goose maps auto -> bypassPermissions, smart_approve -> auto, approve -> default.
    const goose = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'auto',
        options: [
          { value: 'auto', name: 'Auto' },
          { value: 'approve', name: 'approve' },
          { value: 'smart_approve', name: 'smart_approve' }
        ]
      },
      i18n.t,
      'goose'
    )
    expect(goose?.currentCanonicalMode).toBe('bypassPermissions')
    expect(goose?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['default', 'approve'],
      ['auto', 'smart_approve'],
      ['bypassPermissions', 'auto']
    ])

    // MiniMax Code & Amp expose permission policies via configOptions instead of session mode.
    const minimaxPerm = findLocalPermissionConfigOption(
      [
        {
          id: 'permission_mode',
          name: 'Permission mode',
          type: 'select',
          currentValue: 'auto',
          options: [
            { value: 'ask', name: 'Ask' },
            { value: 'auto', name: 'Auto' },
            { value: 'full_access', name: 'Full access' }
          ]
        }
      ],
      'minimax'
    )
    const minimaxUnified = resolveUnifiedLocalPermissionModes(minimaxPerm, i18n.t, 'minimax')
    expect(minimaxUnified?.currentCanonicalMode).toBe('auto')
    expect(minimaxUnified?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['default', 'ask'],
      ['auto', 'auto'],
      ['bypassPermissions', 'full_access']
    ])

    const ampPerm = findLocalPermissionConfigOption(
      [
        {
          id: 'permissions',
          name: 'Permissions',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'bypass', name: 'Bypass' }
          ]
        }
      ],
      'amp-acp'
    )
    const ampUnified = resolveUnifiedLocalPermissionModes(ampPerm, i18n.t, 'amp-acp')
    expect(ampUnified?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['default', 'default'],
      ['bypassPermissions', 'bypass']
    ])

    const glm = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'default',
        options: [
          { value: 'default', name: 'Ask for permission' },
          { value: 'accept_edits', name: 'Auto-approve edits' },
          { value: 'bypass_permissions', name: 'Bypass all permissions' }
        ]
      },
      i18n.t,
      'glm-acp-agent'
    )
    expect(glm?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['default', 'default'],
      ['acceptEdits', 'accept_edits'],
      ['bypassPermissions', 'bypass_permissions']
    ])

    const vibe = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'accept-edits',
        options: [
          { value: 'ask', name: 'ask' },
          { value: 'accept-edits', name: 'accept-edits' },
          { value: 'auto-approve', name: 'auto-approve' }
        ]
      },
      i18n.t,
      'mistral-vibe'
    )
    expect(vibe?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['plan', 'ask'],
      ['acceptEdits', 'accept-edits'],
      ['bypassPermissions', 'auto-approve']
    ])

    const hermes = resolveUnifiedLocalPermissionModes(
      {
        id: 'edit_approval_policy',
        currentValue: 'ask',
        options: [
          { value: 'ask', name: 'Default' },
          { value: 'workspace_session', name: 'Accept Edits' },
          { value: 'session', name: "Don't Ask" }
        ]
      },
      i18n.t,
      'hermes'
    )
    expect(hermes?.currentCanonicalMode).toBe('default')
    expect(hermes?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['default', 'ask'],
      ['acceptEdits', 'workspace_session'],
      ['auto', 'session']
    ])

    const cline = resolveUnifiedLocalPermissionModes(
      {
        id: 'mode',
        currentValue: 'act',
        options: [
          { value: 'plan', name: 'Plan' },
          { value: 'act', name: 'Act' }
        ]
      },
      i18n.t,
      'cline'
    )
    expect(cline?.currentCanonicalMode).toBe('default')
    expect(cline?.options.map((o) => [o.canonicalMode, o.value])).toEqual([
      ['plan', 'plan'],
      ['default', 'act']
    ])
  })

  it('detects uncategorized thinking effort configOptions without catching unrelated selects', () => {
    expect(
      isLocalThoughtConfigOption({
        id: 'reasoning',
        name: 'Reasoning',
        type: 'select',
        currentValue: 'off',
        options: [
          { value: 'off', name: 'Off' },
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
          { value: 'max', name: 'Max' }
        ]
      })
    ).toBe(true)

    expect(
      isLocalThoughtConfigOption({
        id: 'workflow_mode',
        name: 'Workflow mode',
        type: 'select',
        currentValue: 'off',
        options: [
          { value: 'off', name: 'Off' },
          { value: 'on', name: 'On' }
        ]
      })
    ).toBe(false)
  })
})
