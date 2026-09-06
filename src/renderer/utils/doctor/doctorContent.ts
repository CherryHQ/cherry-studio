import type {
  DoctorAction,
  DoctorCheckCatalog,
  DoctorCheckId,
  DoctorCheckStatus,
  DoctorDetailVariant,
  DoctorFixableCheckId,
  DoctorFixId,
  DoctorNavigateTarget
} from '@shared/types/doctor'

type DisplayedDoctorDomain = DoctorCheckCatalog[DoctorCheckId]['domain']
type DoctorCheckContentMap = {
  readonly [Id in DoctorCheckId]: {
    readonly title: string
    readonly details: Readonly<Record<DoctorDetailVariant<Id>, string>>
  }
}
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

export const DOCTOR_CHECK_CONTENT = {
  'install-version-channel': {
    title: 'settings.doctor.checks.install-version-channel.title',
    details: { mismatch: 'settings.doctor.checks.install-version-channel.detail.mismatch' }
  },
  'install-update-available': {
    title: 'settings.doctor.checks.install-update-available.title',
    details: {
      available: 'settings.doctor.checks.install-update-available.detail.available',
      unsupported: 'settings.doctor.checks.install-update-available.detail.unsupported'
    }
  },
  'install-native-modules': {
    title: 'settings.doctor.checks.install-native-modules.title',
    details: { unavailable: 'settings.doctor.checks.install-native-modules.detail.unavailable' }
  },
  'permission-screen-capture': {
    title: 'settings.doctor.checks.permission-screen-capture.title',
    details: {
      denied: 'settings.doctor.checks.permission-screen-capture.detail.denied',
      restricted: 'settings.doctor.checks.permission-screen-capture.detail.restricted'
    }
  },
  'permission-accessibility': {
    title: 'settings.doctor.checks.permission-accessibility.title',
    details: { denied: 'settings.doctor.checks.permission-accessibility.detail.denied' }
  },
  'storage-userdata-location': {
    title: 'settings.doctor.checks.storage-userdata-location.title',
    details: { fallback_to_default: 'settings.doctor.checks.storage-userdata-location.detail.fallback_to_default' }
  },
  'storage-disk-space': {
    title: 'settings.doctor.checks.storage-disk-space.title',
    details: {
      critical: 'settings.doctor.checks.storage-disk-space.detail.critical',
      low: 'settings.doctor.checks.storage-disk-space.detail.low'
    }
  },
  'storage-diagnostic-data-size': {
    title: 'settings.doctor.checks.storage-diagnostic-data-size.title',
    details: {
      large: 'settings.doctor.checks.storage-diagnostic-data-size.detail.large',
      large_partial: 'settings.doctor.checks.storage-diagnostic-data-size.detail.large_partial'
    }
  },
  'config-boot-config-valid': {
    title: 'settings.doctor.checks.config-boot-config-valid.title',
    details: {
      invalid_keys: 'settings.doctor.checks.config-boot-config-valid.detail.invalid_keys',
      parse_error: 'settings.doctor.checks.config-boot-config-valid.detail.parse_error',
      read_error: 'settings.doctor.checks.config-boot-config-valid.detail.read_error'
    }
  },
  'config-hardware-acceleration': {
    title: 'settings.doctor.checks.config-hardware-acceleration.title',
    details: {
      disabled_without_recent_crash:
        'settings.doctor.checks.config-hardware-acceleration.detail.disabled_without_recent_crash'
    }
  },
  'provider-default-model': {
    title: 'settings.doctor.checks.provider-default-model.title',
    details: {
      not_configured: 'settings.doctor.checks.provider-default-model.detail.not_configured',
      invalid_id: 'settings.doctor.checks.provider-default-model.detail.invalid_id',
      provider_unavailable: 'settings.doctor.checks.provider-default-model.detail.provider_unavailable',
      provider_disabled: 'settings.doctor.checks.provider-default-model.detail.provider_disabled',
      model_unavailable: 'settings.doctor.checks.provider-default-model.detail.model_unavailable'
    }
  },
  'provider-api-key-present': {
    title: 'settings.doctor.checks.provider-api-key-present.title',
    details: {
      missing: 'settings.doctor.checks.provider-api-key-present.detail.missing',
      provider_unavailable: 'settings.doctor.checks.provider-api-key-present.detail.provider_unavailable'
    }
  },
  'provider-cherry-account': {
    title: 'settings.doctor.checks.provider-cherry-account.title',
    details: { signed_out: 'settings.doctor.checks.provider-cherry-account.detail.signed_out' }
  },
  'network-online': {
    title: 'settings.doctor.checks.network-online.title',
    details: { offline: 'settings.doctor.checks.network-online.detail.offline' }
  },
  'network-dns-resolution': {
    title: 'settings.doctor.checks.network-dns-resolution.title',
    details: {
      resolved: 'settings.doctor.checks.network-dns-resolution.detail.resolved',
      via_proxy: 'settings.doctor.checks.network-dns-resolution.detail.via_proxy',
      unresolved: 'settings.doctor.checks.network-dns-resolution.detail.unresolved',
      no_response: 'settings.doctor.checks.network-dns-resolution.detail.no_response'
    }
  },
  'network-tls-handshake': {
    title: 'settings.doctor.checks.network-tls-handshake.title',
    details: {
      ok: 'settings.doctor.checks.network-tls-handshake.detail.ok',
      skipped_proxy: 'settings.doctor.checks.network-tls-handshake.detail.skipped_proxy',
      certificate: 'settings.doctor.checks.network-tls-handshake.detail.certificate',
      unreachable: 'settings.doctor.checks.network-tls-handshake.detail.unreachable'
    }
  },
  'network-proxy-applied': {
    title: 'settings.doctor.checks.network-proxy-applied.title',
    details: {
      direct: 'settings.doctor.checks.network-proxy-applied.detail.direct',
      proxy: 'settings.doctor.checks.network-proxy-applied.detail.proxy',
      custom_without_url: 'settings.doctor.checks.network-proxy-applied.detail.custom_without_url',
      system_read_failed: 'settings.doctor.checks.network-proxy-applied.detail.system_read_failed',
      apply_failed: 'settings.doctor.checks.network-proxy-applied.detail.apply_failed'
    }
  },
  'network-endpoint-update': {
    title: 'settings.doctor.checks.network-endpoint-update.title',
    details: {
      reachable: 'settings.doctor.checks.network-endpoint-update.detail.reachable',
      untrusted_tls: 'settings.doctor.checks.network-endpoint-update.detail.untrusted_tls',
      unreachable: 'settings.doctor.checks.network-endpoint-update.detail.unreachable',
      proxy_auth: 'settings.doctor.checks.network-endpoint-update.detail.proxy_auth',
      server_error: 'settings.doctor.checks.network-endpoint-update.detail.server_error',
      timeout: 'settings.doctor.checks.network-endpoint-update.detail.timeout'
    }
  },
  'network-endpoint-registry': {
    title: 'settings.doctor.checks.network-endpoint-registry.title',
    details: {
      reachable: 'settings.doctor.checks.network-endpoint-registry.detail.reachable',
      untrusted_tls: 'settings.doctor.checks.network-endpoint-registry.detail.untrusted_tls',
      unreachable: 'settings.doctor.checks.network-endpoint-registry.detail.unreachable',
      proxy_auth: 'settings.doctor.checks.network-endpoint-registry.detail.proxy_auth',
      server_error: 'settings.doctor.checks.network-endpoint-registry.detail.server_error',
      timeout: 'settings.doctor.checks.network-endpoint-registry.detail.timeout'
    }
  },
  'network-endpoint-cloud': {
    title: 'settings.doctor.checks.network-endpoint-cloud.title',
    details: {
      reachable: 'settings.doctor.checks.network-endpoint-cloud.detail.reachable',
      untrusted_tls: 'settings.doctor.checks.network-endpoint-cloud.detail.untrusted_tls',
      unreachable: 'settings.doctor.checks.network-endpoint-cloud.detail.unreachable',
      proxy_auth: 'settings.doctor.checks.network-endpoint-cloud.detail.proxy_auth',
      server_error: 'settings.doctor.checks.network-endpoint-cloud.detail.server_error',
      timeout: 'settings.doctor.checks.network-endpoint-cloud.detail.timeout'
    }
  },
  'network-endpoint-diagnostics': {
    title: 'settings.doctor.checks.network-endpoint-diagnostics.title',
    details: {
      reachable: 'settings.doctor.checks.network-endpoint-diagnostics.detail.reachable',
      untrusted_tls: 'settings.doctor.checks.network-endpoint-diagnostics.detail.untrusted_tls',
      unreachable: 'settings.doctor.checks.network-endpoint-diagnostics.detail.unreachable',
      proxy_auth: 'settings.doctor.checks.network-endpoint-diagnostics.detail.proxy_auth',
      server_error: 'settings.doctor.checks.network-endpoint-diagnostics.detail.server_error',
      timeout: 'settings.doctor.checks.network-endpoint-diagnostics.detail.timeout'
    }
  },
  'mcp-servers-connected': {
    title: 'settings.doctor.checks.mcp-servers-connected.title',
    details: { server_errors: 'settings.doctor.checks.mcp-servers-connected.detail.server_errors' }
  },
  'mcp-launch-commands': {
    title: 'settings.doctor.checks.mcp-launch-commands.title',
    details: {
      query_failed: 'settings.doctor.checks.mcp-launch-commands.detail.query_failed',
      unresolved: 'settings.doctor.checks.mcp-launch-commands.detail.unresolved'
    }
  },
  'runtime-managed-tools': {
    title: 'settings.doctor.checks.runtime-managed-tools.title',
    details: { failed: 'settings.doctor.checks.runtime-managed-tools.detail.failed' }
  },
  'runtime-claude-login': {
    title: 'settings.doctor.checks.runtime-claude-login.title',
    details: { not_logged_in: 'settings.doctor.checks.runtime-claude-login.detail.not_logged_in' }
  },
  'logs-recent-findings': {
    title: 'settings.doctor.checks.logs-recent-findings.title',
    details: { findings: 'settings.doctor.checks.logs-recent-findings.detail.findings' }
  }
} as const satisfies DoctorCheckContentMap
