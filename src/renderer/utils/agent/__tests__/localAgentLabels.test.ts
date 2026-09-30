import { createInstance } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import zh from '@renderer/i18n/locales/zh-cn.json'
import { reasoningEffortLabel } from '@renderer/utils/reasoning'
import type { LocalAgentConfigOption } from '@shared/ai/localAgent'

import { localAgentConfigOptions, localAgentModeOptions } from '../localAgentLabels'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'zh', resources: { en: { translation: en }, zh: { translation: zh } }, keySeparator: false })
})

describe('installed agent translations', () => {
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
})
