import * as z from 'zod'

import type { AcpLoginProfile } from '@cherrystudio/agent-runtime-acp/profile'
import { ampCli } from '@cherrystudio/agent-runtime-amp-acp/cli'
import { antigravityCli } from '@cherrystudio/agent-runtime-antigravity-acp/cli'
import { claudeCli } from '@cherrystudio/agent-runtime-claude-code/cli'
import { clineCli } from '@cherrystudio/agent-runtime-cline-acp/cli'
import { codeBuddyCli } from '@cherrystudio/agent-runtime-codebuddy-acp/cli'
import {
  codexCli,
  CODEX_LOCAL_MODE_ID,
  CODEX_LOCAL_MODE_OPTIONS,
  CODEX_LOCAL_THOUGHT_LEVEL_ID,
  CODEX_LOCAL_THOUGHT_LEVEL_OPTIONS
} from '@cherrystudio/agent-runtime-codex/cli'
import { copilotCli } from '@cherrystudio/agent-runtime-copilot-acp/cli'
import { dshCli } from '@cherrystudio/agent-runtime-deepseek-harness-acp/cli'
import { factoryCli } from '@cherrystudio/agent-runtime-factory-acp/cli'
import { glmCli } from '@cherrystudio/agent-runtime-glm-acp/cli'
import { gooseCli } from '@cherrystudio/agent-runtime-goose-acp/cli'
import { grokCli } from '@cherrystudio/agent-runtime-grok-acp/cli'
import { hermesCli } from '@cherrystudio/agent-runtime-hermes-acp/cli'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { kiroCli } from '@cherrystudio/agent-runtime-kiro-acp/cli'
import { minimaxCli } from '@cherrystudio/agent-runtime-minimax-acp/cli'
import { ompCli } from '@cherrystudio/agent-runtime-omp-acp/cli'
import { openClawCli } from '@cherrystudio/agent-runtime-openclaw-acp/cli'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { piCli } from '@cherrystudio/agent-runtime-pi-acp/cli'
import { poolsideCli } from '@cherrystudio/agent-runtime-poolside-acp/cli'
import { qoderCli } from '@cherrystudio/agent-runtime-qoder-acp/cli'
import { qwenCli } from '@cherrystudio/agent-runtime-qwen-acp/cli'
import { snowCli } from '@cherrystudio/agent-runtime-snow-acp/cli'
import { traeCli } from '@cherrystudio/agent-runtime-trae-acp/cli'
import { vibeCli } from '@cherrystudio/agent-runtime-vibe-acp/cli'
import { zcodeCli } from '@cherrystudio/agent-runtime-zcode-acp/cli'
import type { CliAuthStatusProbe } from '@cherrystudio/agent-runtime/cli'
import type { CliComponent } from '@cherrystudio/agent-runtime/cli'
import { UniqueModelIdSchema } from '@shared/data/types/model'

import type { LocalCanonicalPermissionMode } from './localAgentPermission'

export const LocalAgentBrowserControlModeSchema = z.enum(['inherit', 'readonly', 'disabled'])
export type LocalAgentBrowserControlMode = z.infer<typeof LocalAgentBrowserControlModeSchema>

export const LocalAgentConfigurationSchema = z.strictObject({
  presetId: z.string().min(1).optional(),
  protocol: z.enum(['acp', 'claude', 'codex', 'cursor']),
  enabled: z.boolean().default(false),
  executableOverride: z.string().trim().min(1).optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).default({}),
  nativeModel: z.string().min(1).optional(),
  sourceModelId: UniqueModelIdSchema.optional(),
  sourceModelViaGateway: z.boolean().optional(),
  browserControl: LocalAgentBrowserControlModeSchema.optional()
})
export type LocalAgentConfiguration = z.infer<typeof LocalAgentConfigurationSchema>

/** Custom third-party executables default to opt-in (`disabled`); built-in presets inherit Browser settings. */
export function resolveLocalAgentBrowserControl(
  config: Pick<LocalAgentConfiguration, 'presetId' | 'browserControl'>
): LocalAgentBrowserControlMode {
  if (config.browserControl) return config.browserControl
  return !config.presetId || config.presetId === 'custom' ? 'disabled' : 'inherit'
}

export const LocalAgentLaunchSettingsSchema = LocalAgentConfigurationSchema.pick({
  executableOverride: true,
  args: true,
  env: true
})
export type LocalAgentLaunchSettings = z.infer<typeof LocalAgentLaunchSettingsSchema>

type PermissionAliases = Readonly<Record<string, { canonicalMode: LocalCanonicalPermissionMode; priority: number }>>

export interface CliAuthOption {
  id: string
  nameKey: string
  hintKey: string
  kind: 'browser' | 'api-key'
  args: readonly string[]
  autoOpenUrl?: boolean
  recommended?: boolean
}

interface LocalAgentCliOptions extends CliComponent {
  cliLogin?: readonly CliAuthOption[]
  providerLogin?: { id: string; args: readonly string[]; suggestions: readonly string[] }

  auth?: AcpLoginProfile
  sessionModel?: true
  minimumAcpVersion?: string
  registryId?: string
  placeholderTitle?: RegExp
  permissionMode?: 'none' | { labels?: PermissionAliases; values?: PermissionAliases }
  defaultMode?: LocalAgentSelection
  terminalArgs?: readonly string[]
  aliases?: readonly string[]
  loginArgs?: readonly string[]
  authStatus?: CliAuthStatusProbe
  /** ACP methods that rely on credentials configured outside the login flow. */
  externalCredentialMethods?: readonly string[]
  terminalCli?: { executable: string; npmPackage?: string; requiredForChat?: true }
  args: readonly string[]
  platformArgs?: Partial<Record<'linux' | 'darwin' | 'win32', readonly string[]>>
  env?: Readonly<Record<string, string>>
  modelDependencies?: readonly string[]
  windowsShell?: { variable: string; allowSh: boolean }
  requiredRuntime?: { executable: 'bun'; minimumVersion: string }
}

interface LocalAgentPresetInfo {
  id: string
  name: string
  helpUrl: string
}

export type LocalCliAgentPreset = LocalAgentPresetInfo &
  LocalAgentCliOptions & {
    protocol: Exclude<LocalAgentConfiguration['protocol'], 'cursor'>
  }

type CursorPreset = LocalAgentPresetInfo & { id: 'cursor'; protocol: 'cursor' } & {
  [K in keyof LocalAgentCliOptions]?: never
}

export type LocalAgentPreset = LocalCliAgentPreset | CursorPreset

export const LOCAL_AGENT_PRESETS: readonly LocalAgentPreset[] = [
  claudeCli,
  codexCli,
  copilotCli,
  minimaxCli,
  {
    id: 'cursor',
    name: 'Cursor',
    protocol: 'cursor',
    helpUrl: 'https://cursor.com/docs/api/sdk/typescript'
  },
  kimiCli,
  qwenCli,
  openCodeCli,
  openClawCli,
  dshCli,
  kiroCli,
  qoderCli,
  traeCli,
  hermesCli,
  clineCli,
  {
    id: 'kilo',
    terminalArgs: [],
    name: 'Kilo',
    protocol: 'acp',
    executable: 'kilo',
    args: ['acp'],
    helpUrl: 'https://kilo.ai/'
  },
  gooseCli,
  codeBuddyCli,
  {
    id: 'auggie',
    terminalArgs: [],
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
  factoryCli,
  {
    id: 'devin',
    terminalArgs: [],
    name: 'Devin',
    protocol: 'acp',
    executable: 'devin',
    args: ['acp'],
    helpUrl: 'https://docs.devin.ai/cli'
  },
  antigravityCli,
  vibeCli,
  ampCli,
  piCli,
  ompCli,
  snowCli,
  zcodeCli,
  {
    id: 'deepagents',
    modelDependencies: ['@langchain/anthropic', '@langchain/openai'],
    name: 'DeepAgents',
    protocol: 'acp',
    executable: 'deepagents-acp',
    args: [],
    helpUrl: 'https://docs.langchain.com/oss/javascript/deepagents/overview'
  },
  glmCli,
  grokCli,
  {
    id: 'cortex-code',
    name: 'Cortex Code',
    protocol: 'acp',
    executable: 'cortex',
    args: ['acp', 'serve'],
    helpUrl: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code'
  },
  poolsideCli
]

export const LOCAL_CLI_AGENT_PRESETS = LOCAL_AGENT_PRESETS.filter((preset) => preset.protocol !== 'cursor')

export const localCliPresetById: ReadonlyMap<string, LocalCliAgentPreset> = new Map(
  LOCAL_CLI_AGENT_PRESETS.map((preset) => [preset.id, preset])
)

const placeholderTitles = LOCAL_CLI_AGENT_PRESETS.flatMap(({ id, placeholderTitle }) =>
  placeholderTitle ? [{ id, pattern: placeholderTitle }] : []
)

/** Resolve the owner only for a matching native title, including when it requires an archive lookup. */
export function isLocalAgentPlaceholderTitle(
  title: string | null | undefined,
  presetId: () => string | undefined
): boolean {
  return !!title && placeholderTitles.some(({ id, pattern }) => pattern.test(title.trim()) && id === presetId())
}

export interface LocalAgentDetection {
  presetId: string
  source: string
  path?: string
  version?: string
  terminalPath?: string
  missingChatExecutable?: string
}

export const LocalAgentAuthMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['agent', 'terminal']).default('agent')
})
export type LocalAgentAuthMethod = z.infer<typeof LocalAgentAuthMethodSchema>

export const LocalAgentModelCatalogSchema = z.object({
  authMethods: z.array(LocalAgentAuthMethodSchema).optional(),
  models: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  activeModel: z.object({ id: z.string(), name: z.string().optional() }).optional()
})
export type LocalAgentModelCatalog = z.infer<typeof LocalAgentModelCatalogSchema>

export const LocalAgentProtocolInfoSchema = z.object({
  protocolVersion: z.number(),
  agent: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }).optional(),
  capabilities: z.record(z.string(), z.unknown()),
  authMethods: z.array(LocalAgentAuthMethodSchema).optional(),
  verified: z.array(z.enum(['handshake', 'session', 'prompt']))
})
export type LocalAgentProtocolInfo = z.infer<typeof LocalAgentProtocolInfoSchema>

export interface LocalAgentSelection {
  id: string
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
}

export const CLAUDE_LOCAL_MODE_ID = 'claude-mode'
export const CLAUDE_LOCAL_MODE_OPTIONS = [
  { value: 'default', name: 'Default' },
  { value: 'acceptEdits', name: 'Accept Edits' },
  { value: 'plan', name: 'Plan' },
  { value: 'auto', name: 'Auto' },
  { value: 'bypassPermissions', name: 'Bypass Permissions' }
] as const

export { DSH_LOCAL_MODE_ID, DSH_LOCAL_MODE_OPTIONS } from '@cherrystudio/agent-runtime-deepseek-harness-acp/cli'

export const CLAUDE_LOCAL_THOUGHT_LEVEL_ID = 'claude-effort'
export const CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS = [
  { value: 'default', name: 'Default' },
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High' },
  { value: 'max', name: 'Max' }
] as const

export function getDefaultLocalAgentMode(
  protocol: LocalAgentConfiguration['protocol'],
  presetId?: string
): LocalAgentSelection | undefined {
  if (protocol === 'claude') {
    return {
      id: CLAUDE_LOCAL_MODE_ID,
      currentValue: 'default',
      options: CLAUDE_LOCAL_MODE_OPTIONS.map((option) => ({ ...option }))
    }
  }
  if (protocol === 'codex') {
    return {
      id: CODEX_LOCAL_MODE_ID,
      currentValue: 'workspace',
      options: CODEX_LOCAL_MODE_OPTIONS.map((option) => ({ ...option }))
    }
  }
  const mode = protocol === 'acp' && presetId ? localCliPresetById.get(presetId)?.defaultMode : undefined
  if (mode) return { ...mode, options: mode.options.map((option) => ({ ...option })) }
  return undefined
}

export function getDefaultLocalAgentThoughtLevel(
  protocol: LocalAgentConfiguration['protocol']
): LocalAgentSelection | undefined {
  if (protocol === 'claude') {
    return {
      id: CLAUDE_LOCAL_THOUGHT_LEVEL_ID,
      currentValue: 'default',
      options: CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS.map((option) => ({ ...option }))
    }
  }
  if (protocol === 'codex') {
    return {
      id: CODEX_LOCAL_THOUGHT_LEVEL_ID,
      currentValue: 'default',
      options: CODEX_LOCAL_THOUGHT_LEVEL_OPTIONS.map((option) => ({ ...option }))
    }
  }
  return undefined
}

export const LOCAL_PERMISSION_CONFIG_OPTION_IDS = new Set([
  'allow_all',
  'sandbox',
  'permission_mode',
  'permission mode',
  'permissionmode',
  'permissions',
  'approval_mode',
  'approval mode'
])

export function isLocalPermissionConfigOptionId(configId: string): boolean {
  return LOCAL_PERMISSION_CONFIG_OPTION_IDS.has(configId.trim().toLowerCase())
}

export interface LocalAgentSessionOverrides {
  mode?: { configId: string; value: string }
  thoughtLevel?: { configId: string; value: string }
  configOptions?: Record<string, string | boolean>
  updatedAt: number
}

export interface LocalAgentNotice {
  severity: 'info' | 'warning' | 'error'
  title: string
  description?: string
}

export type LocalAgentConfigOption = {
  /** The option is valid only while its native session is connected. */
  liveOnly?: true
  id: string
  name: string
  description?: string | null
  category?: string | null
  role?: 'mode' | 'reasoning'
} & (
  | { type: 'boolean'; currentValue: boolean }
  | {
      type: 'select'
      currentValue: string
      options: Array<
        | { value: string; name: string; description?: string | null }
        | { group: string; name: string; options: Array<{ value: string; name: string; description?: string | null }> }
      >
    }
)

export function isLocalPermissionConfigOption(
  option: Pick<LocalAgentConfigOption, 'id' | 'category' | 'role'>
): boolean {
  return option.role === 'mode' || option.category === 'mode' || isLocalPermissionConfigOptionId(option.id)
}

export interface LocalAgentSessionInfo extends LocalAgentModelCatalog {
  configOptions?: LocalAgentConfigOption[]
  mode?: LocalAgentSelection
  thoughtLevel?: LocalAgentSelection
  protocolInfo?: LocalAgentProtocolInfo
  images: boolean
  audio?: boolean
  resume: boolean
}

export const LocalApprovalDecisionSchema = z.enum(['accept', 'acceptForSession', 'acceptAlways', 'decline', 'cancel'])
export type LocalApprovalDecision = z.infer<typeof LocalApprovalDecisionSchema>

export function isLocalAllowDecision(decision: LocalApprovalDecision): boolean {
  return decision === 'accept' || decision === 'acceptForSession' || decision === 'acceptAlways'
}

export const LocalPermissionOptionsSchema = z.object({
  localPermissionOptions: z.array(
    z.object({
      optionId: z.string(),
      decision: LocalApprovalDecisionSchema,
      label: z
        .enum([
          'allow',
          'allow_once',
          'allow_session',
          'allow_always',
          'allow_always_target',
          'allow_always_host',
          'deny',
          'deny_always',
          'deny_always_host',
          'cancel'
        ])
        .optional(),
      labelTarget: z.string().optional(),
      name: z.string(),
      warning: z.string().optional()
    })
  )
})
export type LocalPermissionOption = z.infer<typeof LocalPermissionOptionsSchema>['localPermissionOptions'][number]

export const LocalAgentCheckResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['ready', 'not-installed', 'authentication-required', 'incompatible', 'failed']),
  error: z.string().optional(),
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
    manager: z.enum(['npm', 'uv', 'bun']).optional(),
    detail: z.string().optional()
  })
])
export type LocalAgentInstallResult = z.infer<typeof LocalAgentInstallResultSchema>

export const LocalAgentUninstallComponentSchema = z.object({ executable: z.string().min(1), path: z.string().min(1) })
export type LocalAgentUninstallComponent = z.infer<typeof LocalAgentUninstallComponentSchema>

export const LocalAgentUninstallResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['busy', 'unsupported', 'changed', 'failed', 'partial']),
    detail: z.string().optional(),
    removed: z.array(z.string()).optional(),
    remaining: z.array(z.string()).optional()
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
  turnEnded: z.boolean().optional(),
  title: z.string(),
  name: z.string().optional(),
  kind: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
  locations: z.array(z.object({ path: z.string(), line: z.number().nullish() })).optional(),
  content: z.array(z.unknown()).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  resultField: z.enum(['content', 'rawOutput']).optional(),
  diffPaths: z.array(z.string()).optional(),
  terminals: z.record(z.string(), z.string()).optional(),
  terminalDetails: z
    .record(
      z.string(),
      z.object({ truncated: z.boolean(), exitCode: z.number().optional(), signal: z.string().optional() })
    )
    .optional()
})
export type LocalAcpTool = z.infer<typeof LocalAcpToolSchema>

const LOCAL_ACP_RAW_INPUT_PATH_KEYS = ['path', 'Path', 'file_path', 'filePath', 'TargetFile', 'target_file'] as const

export function extractLocalAcpRawInputPaths(rawInput: unknown): string[] {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) return []
  const record = rawInput as Record<string, unknown>
  const seen = new Set<string>()
  const paths: string[] = []
  for (const key of LOCAL_ACP_RAW_INPUT_PATH_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    paths.push(trimmed)
  }
  return paths
}
