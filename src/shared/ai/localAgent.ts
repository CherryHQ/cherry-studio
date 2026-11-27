import * as z from 'zod'

import type { RuntimeEffortControl, RuntimeModelOption } from '@cherrystudio/agent-runtime'
import type {
  AcpGatewayModelEndpoint,
  AcpLoginProfile,
  AcpPermissionModes
} from '@cherrystudio/agent-runtime-acp/profile'
import { ampCli } from '@cherrystudio/agent-runtime-amp-acp/cli'
import { antigravityCli } from '@cherrystudio/agent-runtime-antigravity-acp/cli'
import { claudeCli } from '@cherrystudio/agent-runtime-claude-code/cli'
import { clineCli } from '@cherrystudio/agent-runtime-cline-acp/cli'
import { codeBuddyCli } from '@cherrystudio/agent-runtime-codebuddy-acp/cli'
import { codexCli } from '@cherrystudio/agent-runtime-codex/cli'
import { copilotCli } from '@cherrystudio/agent-runtime-copilot-acp/cli'
import { cursorPreset } from '@cherrystudio/agent-runtime-cursor/cli'
import { deepAgentsCli } from '@cherrystudio/agent-runtime-deepagents-acp/cli'
import { dshCli } from '@cherrystudio/agent-runtime-deepseek-harness-acp/cli'
import { dimcodeCli } from '@cherrystudio/agent-runtime-dimcode-acp/cli'
import { factoryCli } from '@cherrystudio/agent-runtime-factory-acp/cli'
import { glmCli } from '@cherrystudio/agent-runtime-glm-acp/cli'
import { gooseCli } from '@cherrystudio/agent-runtime-goose-acp/cli'
import { grokCli } from '@cherrystudio/agent-runtime-grok-acp/cli'
import { hermesCli } from '@cherrystudio/agent-runtime-hermes-acp/cli'
import { junieCli } from '@cherrystudio/agent-runtime-junie-acp/cli'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { kiroCli } from '@cherrystudio/agent-runtime-kiro-acp/cli'
import { minimaxCli } from '@cherrystudio/agent-runtime-minimax-acp/cli'
import { museCodeCli } from '@cherrystudio/agent-runtime-muse-code-acp/cli'
import { ompCli } from '@cherrystudio/agent-runtime-omp-acp/cli'
import { openClawCli } from '@cherrystudio/agent-runtime-openclaw-acp/cli'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { piCli } from '@cherrystudio/agent-runtime-pi-acp/cli'
import { poolsideCli } from '@cherrystudio/agent-runtime-poolside-acp/cli'
import { qoderCli, qoderGlobalCli } from '@cherrystudio/agent-runtime-qoder-acp/cli'
import { qwenCli } from '@cherrystudio/agent-runtime-qwen-acp/cli'
import { snowCli } from '@cherrystudio/agent-runtime-snow-acp/cli'
import { traeCli } from '@cherrystudio/agent-runtime-trae-acp/cli'
import { vibeCli } from '@cherrystudio/agent-runtime-vibe-acp/cli'
import { zcodeCli } from '@cherrystudio/agent-runtime-zcode-acp/cli'
import {
  hasPermissionModeChoices,
  parseBooleanLoginStatus,
  selectedPermissionMode,
  type CliAccountProbe,
  type CliComponent,
  type CliLoginDeclaration,
  type PermissionModeApplication,
  type PermissionModeCatalog,
  type PermissionModeChoice,
  type RuntimeAccountDeclaration
} from '@cherrystudio/agent-runtime/cli'
import { ModelSchema, UniqueModelIdSchema } from '@shared/data/types/model'

export const LocalAgentBrowserControlModeSchema = z.enum(['inherit', 'readonly', 'disabled'])
export type LocalAgentBrowserControlMode = z.infer<typeof LocalAgentBrowserControlModeSchema>

export type LocalAgentProtocol = 'acp' | 'claude' | 'codex' | 'cursor'

interface LocalAgentCliOptions extends CliComponent, CliLoginDeclaration {
  auth?: AcpLoginProfile
  gatewayModelEndpoint?: AcpGatewayModelEndpoint
  minimumAcpVersion?: string
  registryId?: string
  placeholderTitle?: RegExp
  permissionMode?: AcpPermissionModes
  legacyModes?: 'effort'
  terminalArgs?: readonly string[]
  aliases?: readonly string[]
  nativeCliInstall?: true
  loginArgs?: readonly string[]
  credentialEnvironment?: readonly string[]
  accountProbe?: CliAccountProbe
  /** ACP methods that rely on credentials configured outside the login flow. */
  externalCredentialMethods?: readonly string[]
  terminalCli?: { executable: string; npmPackage?: string; requiredForChat?: true }
  terminalUsesInstalledCli?: true
  args: readonly string[]
  env?: Readonly<Record<string, string>>
  modelDependencies?: readonly string[]
  windowsShell?: { variable: string; allowSh: boolean }
  requiredRuntime?: { executable: 'bun'; minimumVersion: string }
}

interface LocalAgentPresetInfo {
  id: string
  name: string
  helpUrl: string
  account?: RuntimeAccountDeclaration
  credentialScope?: 'provider'
  retired?: true
  subscriptionUsage?: true
  defaultMode?: PermissionModeCatalog
  modeForLaunch?: (env: Readonly<Record<string, string>>) => PermissionModeCatalog
}

export type LocalCliAgentPreset = LocalAgentPresetInfo &
  LocalAgentCliOptions & {
    protocol: Exclude<LocalAgentProtocol, 'cursor'>
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
  cursorPreset,
  kimiCli,
  qwenCli,
  openCodeCli,
  openClawCli,
  dshCli,
  kiroCli,
  qoderGlobalCli,
  qoderCli,
  traeCli,
  hermesCli,
  clineCli,
  {
    id: 'kilo',
    permissionMode: { values: { code: 'default', plan: 'plan' } },
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
    loginArgs: ['auth', 'login'],
    npmPackage: '@augmentcode/auggie',
    minimumAcpVersion: '1.0.0',
    name: 'Auggie CLI',
    protocol: 'acp',
    executable: 'auggie',
    args: ['--acp'],
    env: {
      AUGMENT_DISABLE_AUTO_UPDATE: '1'
    },
    helpUrl: 'https://www.augmentcode.com/'
  },
  junieCli,
  factoryCli,
  {
    id: 'devin',
    permissionMode: { values: { 'accept-edits': 'default', smart: 'auto', plan: 'plan', bypass: 'bypassPermissions' } },
    terminalArgs: [],
    loginArgs: ['auth', 'login'],
    accountProbe: {
      args: ['auth', 'status'],
      signedOutExitCode: 1,
      parse(output) {
        if (/^Not logged in\b/im.test(output)) return { status: 'signed-out' }
        if (!/^Logged in\b/im.test(output)) return { status: 'unknown' }
        const email = /^\s*Email:[ \t]*(\S+)/im.exec(output)?.[1]
        const displayName = /^\s*Name:[ \t]*([^\r\n]+)/im.exec(output)?.[1]?.trim()
        return { status: 'signed-in', ...(email || displayName ? { account: { email, displayName } } : {}) }
      }
    } satisfies CliAccountProbe,
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
  deepAgentsCli,
  { ...glmCli, retired: true },
  grokCli,
  {
    id: 'command-code',
    name: 'Command Code',
    protocol: 'acp',
    account: { methods: [] },
    accountProbe: {
      args: ['status', '--json'],
      signedOutExitCode: 1,
      parse: (output) => parseBooleanLoginStatus(output, 'authenticated')
    },
    executable: 'command-code',
    npmPackage: 'command-code',
    args: ['acp'],
    terminalArgs: [],
    loginArgs: ['login'],
    credentialEnvironment: ['COMMAND_CODE_API_KEY'],
    helpUrl: 'https://commandcode.ai/docs/acp'
  },
  dimcodeCli,
  museCodeCli,
  {
    id: 'cortex-code',
    permissionMode: { values: { standard: 'default', plan: 'plan', bypass: 'bypassPermissions' } },
    name: 'Cortex Code',
    protocol: 'acp',
    executable: 'cortex',
    args: ['acp', 'serve'],
    helpUrl: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code'
  },
  { ...poolsideCli, retired: true }
]

export function getLocalAgentPreset(presetId: string | undefined): LocalAgentPreset | undefined {
  return LOCAL_AGENT_PRESETS.find((preset) => preset.id === presetId)
}

export function getLocalAgentProtocol(presetId: string | undefined): LocalAgentProtocol {
  if (presetId === undefined) return 'acp'
  const preset = getLocalAgentPreset(presetId)
  if (!preset) throw new Error('Invalid local agent preset')
  return preset.protocol
}

export const LocalAgentConfigurationSchema = z.strictObject({
  presetId: z.enum(LOCAL_AGENT_PRESETS.map(({ id }) => id)).optional(),
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

export const StoredLocalAgentConfigurationSchema = LocalAgentConfigurationSchema.refine(
  ({ presetId, executableOverride }) => presetId !== undefined || executableOverride !== undefined,
  { path: ['executableOverride'], error: 'A custom ACP agent requires an executable' }
)

/** Custom third-party executables default to opt-in (`disabled`); built-in presets inherit Browser settings. */
export function resolveLocalAgentBrowserControl(
  config: Pick<LocalAgentConfiguration, 'presetId' | 'browserControl'>
): LocalAgentBrowserControlMode {
  return config.browserControl ?? (config.presetId === undefined ? 'disabled' : 'inherit')
}

export const LocalAgentLaunchSettingsSchema = LocalAgentConfigurationSchema.pick({
  executableOverride: true,
  args: true,
  env: true
})
export type LocalAgentLaunchSettings = z.infer<typeof LocalAgentLaunchSettingsSchema>

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
  incompatiblePath?: string
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
  subscriptionUsage: z.literal(true).optional(),
  authMethods: z.array(LocalAgentAuthMethodSchema).optional(),
  models: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      description: z.string().optional(),
      _meta: z.record(z.string(), z.unknown()).optional(),
      registryModel: ModelSchema.pick({ capabilities: true, inputModalities: true })
        .extend({ id: z.string() })
        .optional(),
      effort: z
        .object({
          options: z.array(z.object({ value: z.string(), name: z.string(), description: z.string().optional() })),
          defaultValue: z.string().optional()
        })
        .optional()
    }) satisfies z.ZodType<RuntimeModelOption>
  ),
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
  application?: PermissionModeApplication
  options: Array<PermissionModeChoice & { description?: string }>
}

export const ACP_HOST_PERMISSION_MODE_ID = 'cherry:host-permissions'
export const ACP_NATIVE_PLAN_VALUE = 'cherry:native-plan'
const acpHostPermissionChoices = [
  { value: 'default', name: 'Ask Before Acting', permissionMode: 'default' },
  { value: 'acceptEdits', name: 'Auto-accept Edits', permissionMode: 'acceptEdits' },
  { value: 'bypassPermissions', name: 'Full Access', permissionMode: 'bypassPermissions' }
] as const
export type AcpHostPermissionMode = (typeof acpHostPermissionChoices)[number]['value']

export function getAcpNativePlanModes(mode?: LocalAgentSelection) {
  if (mode?.application !== 'session') return undefined
  const plan = mode.options.find((option) => option.permissionMode === 'plan' && !option.requiresConfirmation)
  const work = mode.options.find((option) => option.permissionMode === 'default' && !option.requiresConfirmation)
  return plan && work ? { configId: mode.id, plan: plan.value, work: work.value } : undefined
}

export function getAcpHostPermissionModeSelection(
  nativeMode?: LocalAgentSelection,
  selected?: AcpHostPermissionMode
): LocalAgentSelection | undefined {
  if (
    hasPermissionModeChoices(nativeMode) &&
    nativeMode?.options.some(({ permissionMode }) => permissionMode === 'bypassPermissions')
  )
    return undefined
  const native = selectedPermissionMode(nativeMode)
  const plan = getAcpNativePlanModes(nativeMode)
  return {
    id: ACP_HOST_PERMISSION_MODE_ID,
    currentValue:
      plan && native === 'plan'
        ? 'plan'
        : (selected ?? (native && isAcpHostPermissionMode(native) ? native : 'default')),
    application: 'session',
    options: plan
      ? [...acpHostPermissionChoices, { value: 'plan', name: 'Plan', permissionMode: 'plan' }]
      : [...acpHostPermissionChoices]
  }
}

export function isAcpHostPermissionMode(value: string): value is AcpHostPermissionMode {
  return acpHostPermissionChoices.some((choice) => choice.value === value)
}

export function getLocalAgentLaunchMode(
  config: Pick<LocalAgentConfiguration, 'presetId' | 'env'>
): LocalAgentSelection | undefined {
  const preset = getLocalAgentPreset(config.presetId)
  const catalog = preset?.modeForLaunch?.(config.env) ?? preset?.defaultMode
  return catalog && { ...catalog, options: [...catalog.options] }
}

export interface LocalAgentSessionOverrides {
  mode?: { configId: string; value: string }
  hostPermissionMode?: { agentId: string; value: AcpHostPermissionMode }
  thoughtLevel?: { configId: string; value: string; modelId?: string }
  configOptions?: Record<string, string | boolean>
  updatedAt: number
}

export interface LocalAgentNotice {
  severity: 'info' | 'warning' | 'error'
  title: string
  description?: string
}

export type LocalAgentConfigChoice = PermissionModeChoice & { description?: string | null }

export type LocalAgentConfigOption = {
  /** The option is valid only while its native session is connected. */
  liveOnly?: true
  id: string
  name: string
  description?: string | null
  category?: string | null
  role?: 'mode' | 'reasoning'
  application?: PermissionModeApplication
} & (
  | { type: 'boolean'; currentValue: boolean; confirmationValue?: boolean }
  | {
      type: 'select'
      currentValue: string
      options: Array<LocalAgentConfigChoice | { group: string; name: string; options: LocalAgentConfigChoice[] }>
    }
)

export interface LocalAgentSessionInfo extends LocalAgentModelCatalog {
  modelSelection?: 'selectable' | 'current-only' | 'empty' | 'unsupported' | 'sign-in-required'
  configOptions?: LocalAgentConfigOption[]
  mode?: LocalAgentSelection
  hostPermission?: LocalAgentSelection
  thoughtLevel?: RuntimeEffortControl
  protocolInfo?: LocalAgentProtocolInfo
  images: boolean
  audio?: boolean
  resume: boolean
}

export type LocalAgentSessionView =
  | { info: LocalAgentSessionInfo; idleMode?: never; idleHostPermission?: never }
  | { info: null; idleMode?: LocalAgentSelection; idleHostPermission?: LocalAgentSelection }

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
      persistent: z.literal(true).optional(),
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
const LOCAL_ACP_RAW_INPUT_COMMAND_KEYS = ['CommandLine', 'command', 'cmd'] as const

export function extractLocalAcpRawInputCommand(rawInput: unknown): { key: string; command: string } | undefined {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) return undefined
  const record = rawInput as Record<string, unknown>
  for (const key of LOCAL_ACP_RAW_INPUT_COMMAND_KEYS) {
    const command = record[key]
    if (typeof command === 'string' && command.trim()) return { key, command }
  }
  return undefined
}

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
