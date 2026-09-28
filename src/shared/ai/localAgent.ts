import * as z from 'zod'

export const LocalAgentConfigurationSchema = z.strictObject({
  presetId: z.string().min(1).optional(),
  protocol: z.enum(['acp', 'claude', 'codex']),
  enabled: z.boolean().default(false),
  executableOverride: z.string().trim().min(1).optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).default({}),
  nativeModel: z.string().min(1).optional()
})
export type LocalAgentConfiguration = z.infer<typeof LocalAgentConfigurationSchema>

export interface LocalAgentPreset {
  id: string
  name: string
  protocol: LocalAgentConfiguration['protocol']
  executable: string
  aliases?: readonly string[]
  args: readonly string[]
  helpUrl: string
}

export const LOCAL_AGENT_PRESETS: readonly LocalAgentPreset[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    protocol: 'claude',
    executable: 'claude',
    args: [],
    helpUrl: 'https://code.claude.com/docs/en/setup'
  },
  {
    id: 'codex',
    name: 'Codex',
    protocol: 'codex',
    executable: 'codex',
    args: ['app-server'],
    helpUrl: 'https://developers.openai.com/codex/cli'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    protocol: 'acp',
    executable: 'copilot',
    args: ['--acp'],
    helpUrl: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server'
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    protocol: 'acp',
    executable: 'mcode',
    args: ['acp'],
    helpUrl: 'https://github.com/MiniMax-AI/minimax-code'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    protocol: 'acp',
    executable: 'cursor-agent',
    aliases: ['agent'],
    args: ['acp'],
    helpUrl: 'https://cursor.com/docs/cli/acp'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    protocol: 'acp',
    executable: 'gemini',
    args: ['--acp'],
    helpUrl: 'https://geminicli.com/docs/'
  },
  {
    id: 'kimi',
    name: 'Kimi',
    protocol: 'acp',
    executable: 'kimi',
    args: ['acp'],
    helpUrl: 'https://moonshotai.github.io/kimi-cli/'
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    protocol: 'acp',
    executable: 'qwen',
    args: ['--acp'],
    helpUrl: 'https://qwenlm.github.io/qwen-code-docs/'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    protocol: 'acp',
    executable: 'opencode',
    args: ['acp'],
    helpUrl: 'https://opencode.ai/docs/acp/'
  },
  {
    id: 'kiro',
    name: 'Kiro',
    protocol: 'acp',
    executable: 'kiro-cli',
    args: ['acp'],
    helpUrl: 'https://kiro.dev/docs/cli/acp/'
  },
  {
    id: 'qoder',
    name: 'Qoder',
    protocol: 'acp',
    executable: 'qoderclicn',
    aliases: ['qoder', 'qodercli'],
    args: ['--acp'],
    helpUrl: 'https://docs.qoder.com/cli/acp'
  },
  {
    id: 'trae',
    name: 'Trae',
    protocol: 'acp',
    executable: 'traecli',
    args: ['acp', 'serve'],
    helpUrl: 'https://docs.trae.cn/cli_agent-client-protocol'
  },
  {
    id: 'hermes',
    name: 'Hermes',
    protocol: 'acp',
    executable: 'hermes',
    args: ['acp'],
    helpUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/'
  }
]

export interface LocalAgentDetection {
  presetId: string
  source: string
  path?: string
  version?: string
}

export interface LocalAgentSessionInfo {
  models: Array<{ id: string; name: string }>
  activeModel?: { id: string; name?: string }
  images: boolean
  resume: boolean
}

export const LocalPermissionOptionsSchema = z.object({
  localPermissionOptions: z.array(
    z.object({
      optionId: z.string(),
      label: z.enum(['allow', 'allow_session', 'deny', 'cancel']).optional(),
      name: z.string(),
      kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always'])
    })
  )
})

export const LocalAgentCheckResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['ready', 'not-installed', 'authentication-required', 'incompatible', 'failed']),
  error: z.string().optional(),
  path: z.string().optional(),
  version: z.string().optional()
})
export type LocalAgentCheckResult = z.infer<typeof LocalAgentCheckResultSchema>
