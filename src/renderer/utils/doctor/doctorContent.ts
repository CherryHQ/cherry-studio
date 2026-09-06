import type {
  DoctorAction,
  DoctorCheckCatalog,
  DoctorCheckId,
  DoctorCheckStatus,
  DoctorFixableCheckId,
  DoctorFixId,
  DoctorNavigateTarget
} from '@shared/types/doctor'

type DisplayedDoctorDomain = DoctorCheckCatalog[DoctorCheckId]['domain']
type DoctorFixLabelMap = {
  readonly [Id in DoctorFixableCheckId]: Readonly<Record<DoctorFixId<Id>, DoctorFixLabelDeclaration>>
}
type DoctorActionLabel = {
  readonly key: string
  readonly params?: Readonly<Record<string, string | number>>
}
type DoctorFixAction = Extract<DoctorAction, { kind: 'fix' }>
type DoctorFixTargetNameResolver = (target: string) => string | undefined
type DoctorFixLabelDeclaration =
  | string
  | ((action: DoctorFixAction, resolveTargetName: DoctorFixTargetNameResolver) => DoctorActionLabel)

export const DOCTOR_DOMAIN_LABEL_KEYS = {
  install: 'settings.doctor.domains.install',
  permission: 'settings.doctor.domains.permission',
  storage: 'settings.doctor.domains.storage',
  config: 'settings.doctor.domains.config',
  provider: 'settings.doctor.domains.provider',
  network: 'settings.doctor.domains.network',
  mcp: 'settings.doctor.domains.mcp',
  runtime: 'settings.doctor.domains.runtime',
  logs: 'settings.doctor.domains.logs'
} as const satisfies Record<DisplayedDoctorDomain, string>

export const DOCTOR_STATUS_LABEL_KEYS = {
  pending: 'settings.doctor.status.pending',
  pass: 'settings.doctor.status.pass',
  warn: 'settings.doctor.status.warn',
  fail: 'settings.doctor.status.fail',
  skip: 'settings.doctor.status.skip',
  error: 'settings.doctor.status.error'
} as const satisfies Record<DoctorCheckStatus | 'pending', string>

export const DOCTOR_NAVIGATION_LABEL_KEYS = {
  '/settings/about': 'settings.doctor.actions.open_about',
  '/settings/data': 'settings.doctor.actions.open_data',
  '/settings/dependencies': 'settings.doctor.actions.open_dependencies',
  '/settings/general': 'settings.doctor.actions.open_general',
  '/settings/mcp': 'settings.doctor.actions.open_mcp',
  '/settings/provider': 'settings.doctor.actions.open_provider',
  '/settings/provider?id=claude-code': 'settings.doctor.actions.open_claude_code'
} as const satisfies Record<DoctorNavigateTarget, string>

const DOCTOR_FIX_LABEL_DECLARATIONS = {
  'permission-screen-capture': { request: 'settings.doctor.fixes.request_screen_capture' },
  'permission-accessibility': { request: 'settings.doctor.fixes.request_accessibility' },
  'config-boot-config-valid': { repair: 'settings.doctor.fixes.repair_boot_config' },
  'mcp-servers-connected': {
    restart: (action, resolveTargetName) => {
      const name = action.target ? resolveTargetName(action.target) : undefined
      return name
        ? { key: 'settings.doctor.fixes.restart_mcp', params: { name } }
        : { key: 'settings.doctor.fixes.restart_mcp_generic' }
    }
  }
} as const satisfies DoctorFixLabelMap

const DOCTOR_FIX_LABELS_BY_CHECK: Partial<Record<DoctorCheckId, Readonly<Record<string, DoctorFixLabelDeclaration>>>> =
  DOCTOR_FIX_LABEL_DECLARATIONS

export function resolveDoctorFixLabel(
  checkId: DoctorCheckId,
  action: DoctorFixAction,
  resolveTargetName: DoctorFixTargetNameResolver
): DoctorActionLabel {
  const declaration = DOCTOR_FIX_LABELS_BY_CHECK[checkId]?.[action.fixId]
  if (!declaration) throw new Error(`Missing Doctor fix label: ${checkId}.${action.fixId}`)
  return typeof declaration === 'string' ? { key: declaration } : declaration(action, resolveTargetName)
}
