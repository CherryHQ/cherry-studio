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
  platformArgs?: Partial<Record<'linux' | 'darwin' | 'win32', readonly string[]>>
  env?: Readonly<Record<string, string>>
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
  },
  {
    id: 'cline',
    name: 'Cline',
    protocol: 'acp',
    executable: 'cline',
    args: ['--acp'],
    helpUrl: 'https://cline.bot/cli'
  },
  {
    id: 'kilo',
    name: 'Kilo',
    protocol: 'acp',
    executable: 'kilo',
    args: ['acp'],
    helpUrl: 'https://kilo.ai/'
  },
  {
    id: 'goose',
    name: 'goose',
    protocol: 'acp',
    executable: 'goose',
    args: ['acp'],
    helpUrl: 'https://block.github.io/goose/'
  },
  {
    id: 'codebuddy-code',
    name: 'Codebuddy Code',
    protocol: 'acp',
    executable: 'codebuddy',
    aliases: ['codebuddy-code', 'cbc'],
    args: ['--acp'],
    helpUrl: 'https://www.codebuddy.cn/cli/'
  },
  {
    id: 'auggie',
    name: 'Auggie CLI',
    protocol: 'acp',
    executable: 'auggie',
    args: ['--acp'],
    env: {
      AUGMENT_DISABLE_AUTO_UPDATE: '1'
    },
    helpUrl: 'https://www.augmentcode.com/'
  },
  {
    id: 'junie',
    name: 'Junie',
    protocol: 'acp',
    executable: 'junie',
    args: ['--acp=true'],
    helpUrl: 'https://junie.jetbrains.com'
  },
  {
    id: 'factory-droid',
    name: 'Factory Droid',
    protocol: 'acp',
    executable: 'droid',
    args: ['exec', '--output-format', 'acp-daemon'],
    env: {
      DROID_DISABLE_AUTO_UPDATE: 'true',
      FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false'
    },
    helpUrl: 'https://factory.ai/product/cli'
  },
  {
    id: 'devin',
    name: 'Devin',
    protocol: 'acp',
    executable: 'devin',
    args: ['acp'],
    helpUrl: 'https://docs.devin.ai/cli'
  },
  {
    id: 'antigravity-acp',
    name: 'Google Antigravity',
    protocol: 'acp',
    executable: 'agy_acp_server.par',
    aliases: ['agy_acp_server'],
    platformArgs: {
      linux: ['--uid=']
    },
    args: [],
    helpUrl: 'https://antigravity.google/docs/ide/extensions'
  },
  {
    id: 'mistral-vibe',
    name: 'Mistral Vibe',
    protocol: 'acp',
    executable: 'vibe-acp',
    args: [],
    helpUrl: 'https://mistral.ai/products/vibe'
  },
  {
    id: 'amp-acp',
    name: 'Amp',
    protocol: 'acp',
    executable: 'amp-acp',
    args: [],
    helpUrl: 'https://github.com/tao12345666333/amp-acp'
  },
  {
    id: 'pi-acp',
    name: 'pi ACP',
    protocol: 'acp',
    executable: 'pi-acp',
    args: [],
    helpUrl: 'https://github.com/svkozak/pi-acp'
  },
  {
    id: 'deepagents',
    name: 'DeepAgents',
    protocol: 'acp',
    executable: 'deepagents-acp',
    args: [],
    helpUrl: 'https://docs.langchain.com/oss/javascript/deepagents/overview'
  },
  {
    id: 'glm-acp-agent',
    name: 'GLM Agent',
    protocol: 'acp',
    executable: 'glm-acp-agent',
    args: [],
    helpUrl: 'https://github.com/stefandevo/glm-acp-agent'
  },
  {
    id: 'grok-build',
    name: 'Grok Build',
    protocol: 'acp',
    executable: 'grok',
    args: ['agent', 'stdio'],
    helpUrl: 'https://x.ai/cli'
  },
  {
    id: 'cortex-code',
    name: 'Cortex Code',
    protocol: 'acp',
    executable: 'cortex',
    args: ['acp', 'serve'],
    helpUrl: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code'
  },
  {
    id: 'fast-agent',
    name: 'fast-agent',
    protocol: 'acp',
    executable: 'fast-agent-acp',
    args: ['-x'],
    helpUrl: 'https://fast-agent.ai'
  },
  {
    id: 'stakpak',
    name: 'Stakpak',
    protocol: 'acp',
    executable: 'stakpak',
    args: ['acp'],
    helpUrl: 'https://stakpak.dev'
  },
  {
    id: 'vtcode',
    name: 'VT Code',
    protocol: 'acp',
    executable: 'vtcode',
    args: ['acp'],
    env: {
      VT_ACP_ENABLED: '1',
      VT_ACP_ZED_ENABLED: '1'
    },
    helpUrl: 'https://github.com/vinhnx/VTCode/blob/main/docs/guides/zed-acp.md'
  },
  {
    id: 'poolside',
    name: 'Poolside',
    protocol: 'acp',
    executable: 'pool',
    args: ['acp'],
    helpUrl: 'https://poolside.ai'
  }
]

export interface LocalAgentDetection {
  presetId: string
  source: string
  path?: string
  version?: string
}

export const LocalAgentModelCatalogSchema = z.object({
  models: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  activeModel: z.object({ id: z.string(), name: z.string().optional() }).optional()
})
export type LocalAgentModelCatalog = z.infer<typeof LocalAgentModelCatalogSchema>

export const LocalAgentProtocolInfoSchema = z.object({
  protocolVersion: z.number(),
  agent: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }).optional(),
  capabilities: z.record(z.string(), z.unknown()),
  authMethods: z.array(z.object({ id: z.string(), name: z.string() })),
  verified: z.array(z.enum(['handshake', 'session', 'prompt']))
})
export type LocalAgentProtocolInfo = z.infer<typeof LocalAgentProtocolInfoSchema>

export interface LocalAgentSelection {
  id: string
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
}

export interface LocalAgentSessionInfo extends LocalAgentModelCatalog {
  mode?: LocalAgentSelection
  thoughtLevel?: LocalAgentSelection
  protocolInfo?: LocalAgentProtocolInfo
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
  version: z.string().optional(),
  protocolInfo: LocalAgentProtocolInfoSchema.optional()
})
export type LocalAgentCheckResult = z.infer<typeof LocalAgentCheckResultSchema>

export const LocalAgentInstallResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), reused: z.boolean(), path: z.string() }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      'registry',
      'unsupported',
      'missing_runtime',
      'managed_runtime',
      'failed',
      'not_detected',
      'stopping'
    ]),
    manager: z.enum(['npm', 'uv']).optional(),
    detail: z.string().optional()
  })
])
export type LocalAgentInstallResult = z.infer<typeof LocalAgentInstallResultSchema>

export const LocalAgentUninstallResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['busy', 'unsupported', 'changed', 'failed']),
    detail: z.string().optional()
  })
])
export type LocalAgentUninstallResult = z.infer<typeof LocalAgentUninstallResultSchema>

export const LocalAgentPlanSchema = z.object({
  entries: z.array(
    z.object({
      content: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
      status: z.enum(['pending', 'in_progress', 'completed'])
    })
  )
})
export type LocalAgentPlan = z.infer<typeof LocalAgentPlanSchema>

export const LocalAcpToolSchema = z.object({
  title: z.string(),
  kind: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
  locations: z.array(z.object({ path: z.string(), line: z.number().optional() })).optional(),
  content: z.array(z.unknown()).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  terminals: z.record(z.string(), z.string()).optional()
})
export type LocalAcpTool = z.infer<typeof LocalAcpToolSchema>
