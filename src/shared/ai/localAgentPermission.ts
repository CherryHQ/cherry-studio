import { localCliPresetById, type LocalAgentSessionInfo } from './localAgent'

export type LocalCanonicalPermissionMode = 'plan' | 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions'

export const HIGH_RISK_MODE_IDENTIFIERS: ReadonlySet<string> = new Set([
  'bypass permissions',
  'bypass all permissions',
  'full access',
  'bypasspermissions',
  'bypass_permissions',
  'bypass-permissions',
  'fullaccess',
  'bypass',
  'yolo',
  'autopilot',
  'auto-approve',
  'auto_approve',
  'allow_all',
  'danger-full-access'
])

const UNSANDBOXED_VALUES = new Set(['false', 'off', 'disabled', 'none', 'local', 'local_environment'])
const UNSANDBOXED_NAMES = new Set(['local environment', 'local'])

export const PERMISSION_CONFIG_OPTION_IDENTIFIERS: ReadonlySet<string> = new Set([
  'permission_mode',
  'permission mode',
  'permissionmode',
  'permissions',
  'approval_mode',
  'approval mode'
])

const NATIVE_PERMISSION_CLASSIFIERS: ReadonlyArray<{
  canonicalMode: LocalCanonicalPermissionMode
  identifiers: ReadonlyMap<string, number>
}> = [
  {
    canonicalMode: 'bypassPermissions',
    identifiers: new Map([
      ['bypasspermissions', 0],
      ['bypass_permissions', 0],
      ['bypass-permissions', 0],
      ['bypass permissions', 0],
      ['bypass all permissions', 0],
      ['fullaccess', 1],
      ['full access', 1],
      ['danger-full-access', 2],
      ['bypass', 3],
      ['yolo', 4],
      ['autopilot', 5],
      ['auto-approve', 5],
      ['auto_approve', 5],
      ['allow_all', 6]
    ])
  },
  {
    canonicalMode: 'plan',
    identifiers: new Map([
      ['plan', 0],
      ['readonly', 1],
      ['read only', 1],
      ['read-only', 1],
      ['read_only', 1],
      ['ask', 2]
    ])
  },
  {
    canonicalMode: 'auto',
    identifiers: new Map([
      ['auto', 0],
      ['smart_approve', 1],
      ['smart approve', 1],
      ['smart-approve', 1]
    ])
  },
  {
    canonicalMode: 'acceptEdits',
    identifiers: new Map([
      ['acceptedits', 0],
      ['accept_edits', 0],
      ['accept-edits', 0],
      ['accept edits', 0],
      ['auto-approve edits', 0],
      ['auto-edit', 1],
      ['auto edit', 1],
      ['autoedit', 1],
      ['auto_edit', 1],
      ['workspace-write', 2],
      ['workspace_session', 2],
      ['workspace', 3],
      ['edit', 4],
      ['build', 5],
      ['code', 6],
      ['agent', 7]
    ])
  },
  {
    canonicalMode: 'default',
    identifiers: new Map([
      ['default', 0],
      ['always ask', 1],
      ['alwaysask', 1],
      ['always-ask', 1],
      ['always_ask', 1],
      ['guarded', 2],
      ['approve', 2],
      ['manual', 3],
      ['supervised', 4]
    ])
  }
]

/** Classify a native agent mode/choice option onto Cherry Studio's canonical permission tier. */
export function classifyNativePermissionMode(
  option: { value: string; name: string },
  presetId?: string
): { canonicalMode: LocalCanonicalPermissionMode; priority: number } | undefined {
  const aliases = presetId ? localCliPresetById.get(presetId)?.permissionMode : undefined
  if (aliases === 'none') return undefined
  const value = option.value.trim().toLowerCase()
  const name = option.name.trim().toLowerCase()
  const label = aliases?.labels
  if (label && Object.hasOwn(label, value)) return label[value]
  if (label && Object.hasOwn(label, name)) return label[name]
  if (name === 'default' && value !== 'plan') return { canonicalMode: 'default', priority: 0 }
  if (aliases?.values && Object.hasOwn(aliases.values, value)) return aliases.values[value]

  for (const classifier of NATIVE_PERMISSION_CLASSIFIERS) {
    const valuePriority = classifier.identifiers.get(value)
    const namePriority = classifier.identifiers.get(name)
    if (valuePriority !== undefined && namePriority !== undefined) {
      return { canonicalMode: classifier.canonicalMode, priority: Math.min(valuePriority, namePriority) }
    }
    if (valuePriority !== undefined) {
      return { canonicalMode: classifier.canonicalMode, priority: valuePriority }
    }
    if (namePriority !== undefined) {
      return { canonicalMode: classifier.canonicalMode, priority: namePriority }
    }
  }
  return undefined
}

/** Return true when a local agent session option grants unrestricted host/tool execution. */
export function isHighRiskLocalOption({
  kind,
  optionId,
  value,
  name
}: {
  kind: 'mode' | 'thought' | 'config'
  optionId: string
  value: string | boolean
  name?: string
}): boolean {
  if (kind === 'mode') {
    const normalizedValue = String(value).trim().toLowerCase()
    const normalizedName = name?.trim().toLowerCase()
    return (
      HIGH_RISK_MODE_IDENTIFIERS.has(normalizedValue) ||
      (!!normalizedName && HIGH_RISK_MODE_IDENTIFIERS.has(normalizedName))
    )
  }
  if (kind === 'config' && optionId === 'allow_all') {
    return value === true || ['true', 'on'].includes(String(value).trim().toLowerCase())
  }
  if (kind === 'config' && optionId === 'sandbox') {
    const normalizedValue = String(value).trim().toLowerCase()
    const normalizedName = name?.trim().toLowerCase()
    return (
      value === false ||
      UNSANDBOXED_VALUES.has(normalizedValue) ||
      (!!normalizedName && UNSANDBOXED_NAMES.has(normalizedName))
    )
  }
  return false
}

/** Resolve the effective canonical permission tier from a local agent's live mode and config options. */
export function resolveEffectiveLocalPermissionMode(
  info: Pick<LocalAgentSessionInfo, 'mode' | 'configOptions'> | undefined,
  presetId?: string
): LocalCanonicalPermissionMode | undefined {
  if (!info) return undefined

  for (const option of info.configOptions ?? []) {
    if (option.id.trim().toLowerCase() !== 'allow_all') continue
    if (option.currentValue === true || ['true', 'on'].includes(String(option.currentValue).trim().toLowerCase())) {
      return 'bypassPermissions'
    }
  }

  if (info.mode) {
    const active = info.mode.options.find((option) => option.value === info.mode!.currentValue)
    const matched = classifyNativePermissionMode(
      { value: active?.value ?? info.mode.currentValue, name: active?.name ?? info.mode.currentValue },
      presetId
    )
    if (matched) return matched.canonicalMode
  }

  for (const option of info.configOptions ?? []) {
    if (option.type !== 'select') continue
    const id = option.id.trim().toLowerCase()
    const name = option.name.trim().toLowerCase()
    if (!PERMISSION_CONFIG_OPTION_IDENTIFIERS.has(id) && !PERMISSION_CONFIG_OPTION_IDENTIFIERS.has(name)) continue
    const choices = option.options.flatMap((choice) => ('group' in choice ? choice.options : [choice]))
    const active = choices.find((choice) => choice.value === option.currentValue)
    const matched = classifyNativePermissionMode(
      { value: active?.value ?? option.currentValue, name: active?.name ?? option.currentValue },
      presetId
    )
    if (matched) return matched.canonicalMode
  }

  return undefined
}
