import type { AgentPermissionMode, PermissionModeChoice } from '@cherrystudio/agent-runtime/cli'

export interface AcpPermissionModes {
  values?: Readonly<Record<string, AgentPermissionMode>>
  labels?: Readonly<Record<string, AgentPermissionMode>>
  configIds?: readonly string[]
  approvalConfigId?: string
  bypassArgs?: readonly string[]
  workflowConfigId?: string
  workflowValues?: Readonly<Record<string, 'work' | 'read-only'>>
  persistentConfigIds?: readonly string[]
  nativePermissionNames?: true
  nativeApprovalOnly?: true
  legacyPlan?: true
  allowAll?: string
}

const permissionConfigIds = new Set([
  'permission_mode',
  'permission mode',
  'permissionmode',
  'permissions',
  'approval_mode',
  'approval mode'
])

const unrestricted = new Set([
  'bypasspermissions',
  'bypass_permissions',
  'bypass-permissions',
  'bypass permissions',
  'bypass all permissions',
  'fullaccess',
  'full access',
  'danger-full-access',
  'bypass',
  'yolo',
  'autopilot',
  'auto-approve',
  'auto_approve',
  'allow_all'
])

const unsandboxed = new Set(['false', 'off', 'disabled', 'none', 'local', 'local_environment', 'local environment'])
const readOnly = new Set(['plan', 'readonly', 'read-only', 'read_only', 'read only'])

export function acpPermissionControl(
  { id, name, category }: { id: string; name: string; category?: string | null },
  declared?: AcpPermissionModes
) {
  const key = id.trim().toLowerCase()
  if (key === 'allow_all' || key === 'sandbox') return key
  if (
    category === 'mode' ||
    declared?.approvalConfigId === id ||
    declared?.workflowConfigId === id ||
    declared?.configIds?.includes(id) ||
    permissionConfigIds.has(key) ||
    permissionConfigIds.has(name.trim().toLowerCase())
  )
    return 'mode'
  return undefined
}

export function acpPermissionChoice<T extends { value: string; name: string }>(
  choice: T,
  control: ReturnType<typeof acpPermissionControl>,
  declared?: AcpPermissionModes
): T & Omit<PermissionModeChoice, 'value' | 'name'> {
  if (!control) return choice
  const value = choice.value.trim().toLowerCase()
  const label = choice.name.trim().toLowerCase()
  if (control === 'allow_all' && declared?.approvalConfigId !== 'allow_all') {
    if (value !== 'true' && value !== 'on') return choice
    return { ...choice, requiresConfirmation: true }
  }
  if (control === 'sandbox') {
    return unsandboxed.has(value) || unsandboxed.has(label) ? { ...choice, requiresConfirmation: true } : choice
  }
  const workflow =
    declared?.workflowValues && Object.hasOwn(declared.workflowValues, value)
      ? declared.workflowValues[value]
      : undefined
  if (workflow) return { ...choice, workflowOnly: true, ...(workflow === 'read-only' && { restrictHost: true }) }
  const permissionMode =
    (declared?.values && Object.hasOwn(declared.values, value) ? declared.values[value] : undefined) ??
    (declared?.labels && Object.hasOwn(declared.labels, label) ? declared.labels[label] : undefined)
  return {
    ...choice,
    ...(permissionMode ? { permissionMode } : {}),
    ...(!permissionMode && (readOnly.has(value) || readOnly.has(label)) ? { restrictHost: true as const } : {}),
    ...(!permissionMode && (unrestricted.has(value) || unrestricted.has(label))
      ? { requiresConfirmation: true as const }
      : {})
  }
}
