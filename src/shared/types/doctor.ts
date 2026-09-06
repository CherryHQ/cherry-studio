import type { AppEdition } from './appEdition'

/**
 * System Doctor contract shared by main (produces reports) and renderer (renders them).
 *
 * `DOCTOR_CHECK_CATALOG` is the single source of truth for which checks exist, what
 * they can fix and which detail variants they emit. Every other type here is derived
 * from it, so adding a check means adding one catalog entry — the main registry then
 * fails to compile until the check is implemented, and a renderer cannot reference a
 * fix or detail the check never declared.
 */

export type DoctorDomain =
  | 'install'
  | 'permission'
  | 'storage'
  | 'config'
  | 'provider'
  | 'network'
  | 'mcp'
  | 'runtime'
  | 'health'
  | 'logs'

export type DoctorTier = 'quick' | 'live' | 'deep'

/** Who can act on a finding: mirrors the log-scan attribution so both surfaces speak one language. */
export type DoctorAttribution = 'user-fixable' | 'app-bug' | 'transient'

/**
 * How far a piece of report data may travel. `public` is safe to paste in an issue,
 * `local_only` stays on this machine (paths, hostnames), `consent_required` needs an
 * explicit opt-in per export/upload (crash dumps, raw error bodies).
 */
export type DoctorDataClass = 'public' | 'local_only' | 'consent_required'

/**
 * `low` runs on click and is idempotent + reversible; `confirm` needs an explicit
 * confirmation dialog first. Destructive recoveries are never fixes — they navigate
 * to their own guarded flows.
 */
export type DoctorFixRisk = 'low' | 'confirm'

export interface DoctorFixMeta {
  readonly id: string
  readonly risk: DoctorFixRisk
  readonly reversible: boolean
  /** The fix only takes effect after `app.relaunch`. */
  readonly relaunch: boolean
}

export const DOCTOR_CHECK_IDS = [
  'config-boot-config-valid',
  'storage-userdata-location',
  'network-online',
  'network-dns-resolution',
  'network-tls-handshake',
  'network-proxy-applied',
  'network-endpoint-update',
  'network-endpoint-registry',
  'network-endpoint-cloud',
  'network-endpoint-diagnostics'
] as const
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number]

/** The domain a check id is prefixed with — enforced on the catalog at compile time. */
type DomainOfId<Id extends string> = Id extends `${infer Domain}-${string}` ? Domain : never

export interface DoctorCheckMeta<Id extends DoctorCheckId> {
  readonly domain: DomainOfId<Id> & DoctorDomain
  readonly tier: DoctorTier
  /** Fixes this check may offer. The main registry must implement every one. */
  readonly fixes: readonly DoctorFixMeta[]
  /** Detail variants; the i18n key is `settings.doctor.checks.<id>.detail.<variant>`. */
  readonly details: readonly string[]
  /** Checks that must pass first; on their fail/error this check is skipped. */
  readonly requires: readonly Exclude<DoctorCheckId, Id>[]
}

const ENDPOINT_DETAILS = ['reachable', 'untrusted_tls', 'unreachable', 'proxy_auth', 'server_error', 'timeout'] as const

export const DOCTOR_CHECK_CATALOG = {
  'config-boot-config-valid': {
    domain: 'config',
    tier: 'quick',
    fixes: [{ id: 'repair', risk: 'low', reversible: true, relaunch: true }],
    details: ['invalid_keys', 'parse_error', 'read_error'],
    requires: []
  },
  'storage-userdata-location': {
    domain: 'storage',
    tier: 'quick',
    fixes: [],
    details: ['fallback_to_default'],
    requires: []
  },
  'network-online': { domain: 'network', tier: 'quick', fixes: [], details: ['offline'], requires: [] },
  'network-dns-resolution': {
    domain: 'network',
    tier: 'live',
    fixes: [],
    details: ['resolved', 'via_proxy', 'unresolved', 'no_response'],
    requires: ['network-online']
  },
  'network-tls-handshake': {
    domain: 'network',
    tier: 'live',
    fixes: [],
    details: ['ok', 'skipped_proxy', 'certificate', 'unreachable'],
    requires: ['network-dns-resolution']
  },
  'network-proxy-applied': {
    domain: 'network',
    tier: 'live',
    fixes: [],
    details: ['direct', 'proxy', 'custom_without_url', 'system_read_failed', 'apply_failed'],
    requires: []
  },
  'network-endpoint-update': {
    domain: 'network',
    tier: 'live',
    fixes: [],
    details: ENDPOINT_DETAILS,
    requires: ['network-dns-resolution']
  },
  'network-endpoint-registry': {
    domain: 'network',
    tier: 'live',
    fixes: [],
    details: ENDPOINT_DETAILS,
    requires: ['network-dns-resolution']
  },
  'network-endpoint-cloud': {
    domain: 'network',
    tier: 'live',
    fixes: [],
    details: ENDPOINT_DETAILS,
    requires: ['network-dns-resolution']
  },
  'network-endpoint-diagnostics': {
    domain: 'network',
    tier: 'live',
    fixes: [],
    details: ENDPOINT_DETAILS,
    requires: ['network-dns-resolution']
  }
} as const satisfies { readonly [Id in DoctorCheckId]: DoctorCheckMeta<Id> }

export type DoctorCheckCatalog = typeof DOCTOR_CHECK_CATALOG
export type DoctorFixId<Id extends DoctorCheckId> = DoctorCheckCatalog[Id]['fixes'][number]['id']
export type DoctorDetailVariant<Id extends DoctorCheckId> = DoctorCheckCatalog[Id]['details'][number]
export type DoctorFixableCheckId = {
  [Id in DoctorCheckId]: [DoctorFixId<Id>] extends [never] ? never : Id
}[DoctorCheckId]

/** Settings routes a finding may deep-link to. Keep in sync with the renderer settings menu. */
export type DoctorNavigateTarget =
  | '/settings/about'
  | '/settings/data'
  | '/settings/dependencies'
  | '/settings/general'
  | '/settings/mcp'
  | '/settings/provider'

export type DoctorAction<Id extends DoctorCheckId = DoctorCheckId> =
  | ([DoctorFixId<Id>] extends [never] ? never : { readonly kind: 'fix'; readonly fixId: DoctorFixId<Id> })
  | { readonly kind: 'navigate'; readonly target: DoctorNavigateTarget }
  /** Absolute path already resolved by main; the renderer only forwards it to `system.shell.open_path`. */
  | { readonly kind: 'open_path'; readonly path: string }
  | { readonly kind: 'open_external'; readonly url: string }
  | { readonly kind: 'relaunch' }
  | { readonly kind: 'report' }

export interface DoctorDetail<Id extends DoctorCheckId = DoctorCheckId> {
  readonly variant: DoctorDetailVariant<Id>
  readonly params?: Readonly<Record<string, string | number>>
}

/** One raw fact behind a finding, classified so views can drop what must not travel. */
export interface DoctorEvidenceItem {
  readonly key: string
  readonly value: string | number | boolean
  readonly dataClass: DoctorDataClass
}

/** What a probe itself decides. `skip` and `error` are assigned by the engine, never by a check. */
export type DoctorCheckOutcome<Id extends DoctorCheckId = DoctorCheckId> =
  | { readonly status: 'pass'; readonly detail?: DoctorDetail<Id> }
  | {
      readonly status: 'warn' | 'fail'
      readonly attribution: DoctorAttribution
      readonly detail: DoctorDetail<Id>
      readonly actions: readonly DoctorAction<Id>[]
    }

export type DoctorCheckStatus = DoctorCheckOutcome['status'] | 'skip' | 'error'

export type DoctorCheckResultFor<Id extends DoctorCheckId> = {
  readonly id: Id
  readonly durationMs: number
  /** English, developer-facing; travels only inside diagnostic bundles. */
  readonly devMessage?: string
  readonly evidence?: readonly DoctorEvidenceItem[]
} & (
  | DoctorCheckOutcome<Id>
  | { readonly status: 'skip'; readonly skippedBy: DoctorCheckId }
  | { readonly status: 'error'; readonly message: string }
)

export type DoctorCheckResult = { [Id in DoctorCheckId]: DoctorCheckResultFor<Id> }[DoctorCheckId]

/** `quick` runs the quick tier; `live` runs quick + live so a live report is always complete. */
export type DoctorRunTier = 'quick' | 'live'

export interface DoctorBasics {
  readonly version: string
  readonly edition: AppEdition
  readonly channel: 'latest' | 'rc' | 'beta'
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly osRelease: string
  readonly runtime: {
    readonly electron?: string
    readonly node?: string
    readonly chrome?: string
    readonly v8?: string
  }
  readonly isPackaged: boolean
  readonly isPortable: boolean
  /** `local_only`: present in display/export views, stripped from copy/upload. */
  readonly userDataPath?: string
}

/** A report older than this is stale: the dialog asks for a re-run before offering fixes. */
export const DOCTOR_REPORT_TTL_MS = 10 * 60 * 1000

export interface DoctorReport {
  readonly schemaVersion: 1
  /** Identity of the run that produced it; every event and fix request is bound to it. */
  readonly runId: string
  readonly tier: DoctorRunTier
  readonly startedAt: string
  readonly finishedAt: string
  readonly expiresAt: string
  readonly basics: DoctorBasics
  readonly results: readonly DoctorCheckResult[]
  readonly summary: Readonly<Record<DoctorCheckStatus, number>>
}

/**
 * Live state of the doctor, published on the shared cache (`doctor.state`) so every window
 * renders the same run without an IPC subscription. Runs never coexist; a completed run
 * replaces the previous report wholesale (a live run is a superset of quick).
 */
export type DoctorState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running'
      readonly runId: string
      readonly tier: DoctorRunTier
      readonly startedAt: string
      readonly results: readonly DoctorCheckResult[]
    }
  | { readonly status: 'completed'; readonly report: DoctorReport }
  | { readonly status: 'canceled'; readonly runId: string }

/** `busy` carries the in-flight run's id so the caller can cancel it. */
export type DoctorRunResult =
  | { readonly status: 'completed'; readonly report: DoctorReport }
  | { readonly status: 'canceled'; readonly runId: string }
  | { readonly status: 'busy'; readonly runId: string }

export type DoctorCancelResult = { readonly status: 'canceled' | 'not_running' }

export type DoctorFixRequest = {
  [Id in DoctorFixableCheckId]: { readonly runId: string; readonly checkId: Id; readonly fixId: DoctorFixId<Id> }
}[DoctorFixableCheckId]

/**
 * `stale` means the fix was refused: the run was superseded, or a fresh probe no longer
 * offers that fix (someone else already fixed it, or the situation changed).
 */
export type DoctorFixResult =
  | { readonly status: 'fixed' | 'requires_relaunch'; readonly result: DoctorCheckResult }
  | { readonly status: 'failed'; readonly message: string; readonly result: DoctorCheckResult }
  | {
      readonly status: 'stale'
      readonly reason: 'run_superseded' | 'finding_changed'
      readonly result?: DoctorCheckResult
    }

/** Guards, the view projection and the settings-path/i18n-key builders live in `@shared/utils/doctor`. */
