import * as z from 'zod'

import type { RuntimeEffortControl, RuntimeModelOption } from '@cherrystudio/agent-runtime'
import {
  hasPermissionModeChoices,
  selectedPermissionMode,
  type AgentPermissionMode,
  type PermissionModeApplication,
  type PermissionModeChoice
} from '@cherrystudio/agent-runtime/cli'
import {
  getLocalAgentPreset,
  LOCAL_AGENT_PRESETS,
  type LocalAgentProtocol,
  type LocalCliAgentPreset
} from '@shared/data/presets/localAgents'
import { ModelSchema, UniqueModelIdSchema } from '@shared/data/types/model'

export const LocalAgentBrowserControlModeSchema = z.enum(['inherit', 'readonly', 'disabled'])
export type LocalAgentBrowserControlMode = z.infer<typeof LocalAgentBrowserControlModeSchema>

export {
  getLocalAgentPreset,
  LOCAL_AGENT_PRESETS,
  type LocalAgentPreset,
  type LocalAgentProtocol,
  type LocalCliAgentPreset
} from '@shared/data/presets/localAgents'

export function usesPresetAcpLaunch(config: Pick<LocalAgentConfiguration, 'presetId' | 'executableOverride' | 'args'>) {
  const preset = getLocalAgentPreset(config.presetId)
  return (
    preset?.protocol === 'acp' &&
    config.executableOverride === undefined &&
    (config.args.length === 0 ||
      (config.args.length === preset.args.length && config.args.every((arg, i) => arg === preset.args[i])))
  )
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

export const LocalAgentModelSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('native-default') }),
  z.strictObject({ kind: z.literal('native'), modelId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('cherry'), modelId: UniqueModelIdSchema })
])
export type LocalAgentModelSelection = z.infer<typeof LocalAgentModelSelectionSchema>

export function getLocalAgentModelSelection(config: LocalAgentConfiguration): LocalAgentModelSelection {
  if (config.sourceModelViaGateway && config.sourceModelId) return { kind: 'cherry', modelId: config.sourceModelId }
  if (config.nativeModel) return { kind: 'native', modelId: config.nativeModel }
  return { kind: 'native-default' }
}

export function localAgentModelConfig(selection: LocalAgentModelSelection) {
  return {
    nativeModel: selection.kind === 'native' ? selection.modelId : undefined,
    sourceModelId: selection.kind === 'cherry' ? selection.modelId : undefined,
    sourceModelViaGateway: selection.kind === 'cherry' ? true : undefined
  }
}

export const LocalAgentAccountSchema = z.strictObject({
  methodId: z.string().min(1),
  service: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  profileRef: z.string().min(1).optional()
})
export type LocalAgentAccount = z.infer<typeof LocalAgentAccountSchema>

export const LocalAgentRuntimeSchema = LocalAgentConfigurationSchema.extend({
  enabled: LocalAgentConfigurationSchema.shape.enabled.removeDefault(),
  args: LocalAgentConfigurationSchema.shape.args.removeDefault(),
  env: LocalAgentConfigurationSchema.shape.env.removeDefault(),
  providerId: z.string(),
  account: LocalAgentAccountSchema.optional()
})
export type LocalAgentRuntime = z.infer<typeof LocalAgentRuntimeSchema>

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
  uncertain?: true
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
  nativePermissionNames?: true
  options: Array<PermissionModeChoice & { description?: string }>
}

export const ACP_HOST_PERMISSION_MODE_ID = 'cherry:host-permissions'
export const ACP_NATIVE_PLAN_VALUE = 'cherry:native-plan'
export const ACP_LAUNCH_PERMISSION_ID = 'cherry:launch-permissions'
export const ACP_LAUNCH_BYPASS_VALUE = 'cherry:launch-bypass'
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
    new Set(
      nativeMode?.options.flatMap(({ permissionMode, value }) =>
        permissionMode && permissionMode !== 'plan' ? [nativeMode.nativePermissionNames ? value : permissionMode] : []
      )
    ).size >= 2
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

export function getAcpLaunchBypassArgs(config: Pick<LocalAgentConfiguration, 'presetId' | 'args'>) {
  const preset = getLocalAgentPreset(config.presetId)
  if (preset?.protocol !== 'acp') return
  if (
    config.args.length &&
    (config.args.length !== preset.args.length || config.args.some((arg, i) => arg !== preset.args[i]))
  )
    return
  return preset.permissionMode?.bypassArgs
}

export function getAcpLaunchPermission(
  base: LocalAgentSelection | undefined,
  enabled: boolean
): LocalAgentSelection | undefined {
  if (
    !enabled &&
    base?.id !== ACP_HOST_PERMISSION_MODE_ID &&
    base?.options.some(({ permissionMode }) => permissionMode === 'bypassPermissions')
  )
    return
  const options = base?.options.filter(({ permissionMode }) => permissionMode !== 'bypassPermissions') ?? [
    acpHostPermissionChoices[0]
  ]
  return {
    id: ACP_LAUNCH_PERMISSION_ID,
    currentValue: enabled
      ? ACP_LAUNCH_BYPASS_VALUE
      : base?.currentValue === 'bypassPermissions'
        ? 'default'
        : (base?.currentValue ?? 'default'),
    nativePermissionNames: base?.nativePermissionNames,
    options: [...options, { ...acpHostPermissionChoices[2], value: ACP_LAUNCH_BYPASS_VALUE }]
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

export function getLocalPermissionChoice(mode: LocalAgentSelection | undefined, permission: AgentPermissionMode) {
  return mode?.options.find(
    ({ permissionMode, requiresConfirmation }) => permissionMode === permission && !requiresConfirmation
  )
}

export function getLocalSessionPermission(info?: LocalAgentSessionInfo) {
  return info?.launchPermission ?? info?.hostPermission ?? info?.mode
}

export interface LocalAgentSessionOverrides {
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
  role?: 'mode' | 'reasoning' | 'security'
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
  launchPermission?: LocalAgentSelection
  thoughtLevel?: RuntimeEffortControl
  protocolInfo?: LocalAgentProtocolInfo
  images: boolean
  audio?: boolean
  resume: boolean
}

export type LocalAgentSessionView = {
  providerId?: string
  presetId?: LocalAgentConfiguration['presetId']
  subscriptionUsage?: true
} & (
  | {
      info: LocalAgentSessionInfo
      connecting?: never
      permissionUnavailable?: never
      idleMode?: never
      idleHostPermission?: never
      idleLaunchPermission?: never
    }
  | {
      info: null
      connecting?: true
      permissionUnavailable?: true
      idleMode?: LocalAgentSelection
      idleHostPermission?: LocalAgentSelection
      idleLaunchPermission?: LocalAgentSelection
    }
)

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
