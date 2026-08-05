import { Alert, Button, RowFlex } from '@cherrystudio/ui'
import {
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useManualUpdateCheck } from '@renderer/hooks/useManualUpdateCheck'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { BACKUP_RESTORE_NOTICE_KEY } from '@renderer/utils/backupRestoreNotice'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type {
  BackupExportSourceDiagnostic,
  BackupFormatCompatibilityDiagnostic,
  BackupMigrationCompatibilityDiagnostic
} from '@shared/ipc/schemas/backup'
import type { OutputFor } from '@shared/ipc/types'
import { Copy, FolderOpen, Loader, SaveIcon } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BackupProgressDialog from './BackupProgressDialog'

/**
 * Backup v2 — export and restore (docs/references/backup/README.md).
 *
 * The screen is built around the one fact a user must not miss: a restore
 * REPLACES the database, whole. The help text says so, the confirmation says so
 * again, and nothing here offers a merge, because none exists.
 *
 * State lives in main. This component holds only what the current visit
 * produced (the preview it just prepared) and re-reads `backup.get_status`
 * after every action, so a reopened window shows the same truth as a relaunched
 * app — the journal, not this component, is what survives.
 */

type BackupStatus = OutputFor<'backup.get_status'>
type RestorePreview = Extract<OutputFor<'backup.prepare_restore'>, { status: 'prepared' }>['preview']
type JournalRestore = Extract<NonNullable<BackupStatus['restore']>, { kind: 'journal' }>
type PresentedDegradation = NonNullable<JournalRestore['degradations']>[number]
type CompatibilityDiagnostic = BackupMigrationCompatibilityDiagnostic | BackupFormatCompatibilityDiagnostic

/**
 * What is running, identified down to the row that started it — the abortable
 * ones need it so the cancel affordance appears where the user last clicked.
 * `other` covers the instant actions (discard, arm, acknowledge), which only
 * need to hold the busy lock.
 */
type Running = { readonly kind: 'export' } | { readonly kind: 'prepare' } | { readonly kind: 'other' }

/** Written out rather than interpolated, so the keys stay greppable. */
const DEGRADATION_KEYS: Record<PresentedDegradation['code'], string> = {
  'capability-malformed': 'settings.data.backup.outcome.degradation.capability_malformed',
  'external-file-dropped': 'settings.data.backup.outcome.degradation.external_file_dropped',
  'path-unportable': 'settings.data.backup.outcome.degradation.path_unportable',
  'path-collision': 'settings.data.backup.outcome.degradation.path_collision',
  'resource-unavailable': 'settings.data.backup.outcome.degradation.resource_unavailable',
  'resource-changed': 'settings.data.backup.outcome.degradation.resource_changed',
  'resource-nonportable': 'settings.data.backup.outcome.degradation.resource_nonportable',
  'resource-limit': 'settings.data.backup.outcome.degradation.resource_limit',
  'workspace-disconnected': 'settings.data.backup.outcome.degradation.workspace_disconnected',
  'external-reference': 'settings.data.backup.outcome.degradation.external_reference',
  'dangling-reference': 'settings.data.backup.outcome.degradation.dangling_reference',
  'cyclic-reference': 'settings.data.backup.outcome.degradation.cyclic_reference',
  'unclassified-reference': 'settings.data.backup.outcome.degradation.unclassified_reference',
  'knowledge-index-rebuild': 'settings.data.backup.outcome.degradation.knowledge_index_rebuild',
  unknown: 'settings.data.backup.outcome.degradation.unknown'
}

function degradationCount(degradations: readonly PresentedDegradation[]): number {
  return degradations.reduce((total, degradation) => total + degradation.count, 0)
}

const DegradationDetails: FC<{
  degradations: readonly PresentedDegradation[]
  consequenceKey?: string
}> = ({ degradations, consequenceKey }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      {consequenceKey && <p>{t(consequenceKey, { count: degradationCount(degradations) })}</p>}
      <ul className="list-disc pl-5">
        {degradations.map((degradation) => (
          <li key={degradation.code}>
            {t(DEGRADATION_KEYS[degradation.code], { count: degradation.count })}
            {degradation.paths?.length ? (
              <ul className="list-[circle] pl-5 text-muted-foreground">
                {degradation.paths.map((path) => (
                  <li key={path} dir="auto" className="break-all [unicode-bidi:isolate]">
                    {path}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

const BUILD_TYPE_KEYS: Record<CompatibilityDiagnostic['archiveBuildType'], string> = {
  packaged: 'settings.data.backup.compatibility.build_type.packaged',
  development: 'settings.data.backup.compatibility.build_type.development',
  unknown: 'settings.data.backup.compatibility.build_type.unknown'
}

const RESTORE_STATE_KEYS: Record<JournalRestore['state'], string> = {
  prepared: 'settings.data.backup.outcome.state.prepared',
  armed: 'settings.data.backup.outcome.state.armed',
  promoting: 'settings.data.backup.outcome.state.promoting',
  reverting: 'settings.data.backup.outcome.state.reverting',
  completed: 'settings.data.backup.outcome.state.completed',
  'rollback-armed': 'settings.data.backup.outcome.state.rollback_armed',
  'rolled-back': 'settings.data.backup.outcome.state.rolled_back',
  failed: 'settings.data.backup.outcome.state.failed',
  expired: 'settings.data.backup.outcome.state.expired'
}

function compatibilityDiagnosticText(diagnostic: CompatibilityDiagnostic): string {
  const lines = [
    'Cherry Studio backup compatibility',
    `reason: ${diagnostic.kind}`,
    `archiveAppVersion: ${diagnostic.archiveAppVersion ?? 'unknown'}`,
    `archiveBuildType: ${diagnostic.archiveBuildType}`,
    `currentAppVersion: ${diagnostic.currentAppVersion}`,
    `currentBuildType: ${diagnostic.currentBuildType}`
  ]
  if ('sourceMigrationCount' in diagnostic) {
    lines.push(
      `sourceMigrationCount: ${diagnostic.sourceMigrationCount}`,
      `targetMigrationCount: ${diagnostic.targetMigrationCount}`,
      `sourceTip: ${diagnostic.sourceTip.folderMillis}/${diagnostic.sourceTip.hashPrefix}`,
      `targetTip: ${diagnostic.targetTip.folderMillis}/${diagnostic.targetTip.hashPrefix}`
    )
    if (diagnostic.kind === 'source-ahead') {
      lines.push(
        `missingMigrationCount: ${diagnostic.missingMigrationCount}`,
        `firstExtraIndex: ${diagnostic.firstExtraIndex}`
      )
    } else {
      lines.push(`firstDivergentIndex: ${diagnostic.firstDivergentIndex}`)
    }
  } else {
    lines.push(
      `archiveFormatVersion: ${diagnostic.archiveFormatVersion}`,
      `currentFormatVersion: ${diagnostic.currentFormatVersion}`
    )
  }
  return lines.join('\n')
}

function canOfferUpdate(diagnostic: CompatibilityDiagnostic): boolean {
  return (
    diagnostic.currentBuildType === 'packaged' &&
    diagnostic.archiveBuildType !== 'development' &&
    (diagnostic.kind === 'source-ahead' || diagnostic.kind === 'archive-newer')
  )
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function isMigrationTip(value: unknown): boolean {
  return typeof value === 'object' && value !== null && isCount((value as { folderMillis?: unknown }).folderMillis)
}

/**
 * Read back the diagnostic main attached to a compatibility refusal, keeping
 * only the kinds that belong to the code that carried it.
 *
 * Checked by hand rather than with the zod schema, which stays in
 * `@shared/ipc/schemas` — a module the renderer bundle deliberately never
 * value-imports (docs/references/ipc/ipc-overview.md). Main already `.parse()`s
 * this payload before sending it, so what remains for this side is the narrowing
 * a cast cannot do on its own: refuse anything whose rendered fields are not the
 * shape the panel below reads, rather than print whatever arrived.
 */
function compatibilityDiagnostic(
  data: unknown,
  kinds: readonly CompatibilityDiagnostic['kind'][]
): CompatibilityDiagnostic | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const value = data as Record<string, unknown>
  if (!kinds.some((allowed) => allowed === value.kind)) return undefined
  if (typeof value.currentAppVersion !== 'string') return undefined
  if (value.archiveAppVersion !== undefined && typeof value.archiveAppVersion !== 'string') return undefined
  // Looked up in BUILD_TYPE_KEYS, so an unlisted value is a missing translation.
  // `hasOwn`, not `in`: `in` would accept every name on Object's prototype.
  if (typeof value.archiveBuildType !== 'string' || !Object.hasOwn(BUILD_TYPE_KEYS, value.archiveBuildType)) {
    return undefined
  }
  if (value.currentBuildType !== 'packaged' && value.currentBuildType !== 'development') return undefined

  const detailed =
    value.kind === 'archive-newer' || value.kind === 'archive-legacy'
      ? isCount(value.archiveFormatVersion) && isCount(value.currentFormatVersion)
      : isCount(value.sourceMigrationCount) &&
        isCount(value.targetMigrationCount) &&
        isMigrationTip(value.sourceTip) &&
        isMigrationTip(value.targetTip) &&
        (value.kind === 'source-ahead'
          ? isCount(value.missingMigrationCount) && isCount(value.firstExtraIndex)
          : isCount(value.firstDivergentIndex))
  return detailed ? (value as CompatibilityDiagnostic) : undefined
}

interface ExportSourceMessage {
  readonly key: string
  readonly path?: string
}

function isDiagnosticPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false
  if (value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/.test(value)) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function exportSourceDiagnostic(data: unknown): BackupExportSourceDiagnostic | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const value = data as Record<string, unknown>
  if (value.path !== undefined && !isDiagnosticPath(value.path)) return undefined

  switch (value.kind) {
    case 'source-changed':
    case 'non-regular':
      return value.path === undefined || isDiagnosticPath(value.path)
        ? (value as BackupExportSourceDiagnostic)
        : undefined
    case 'unportable-path':
      return value.reason === 'invalid-path' || value.reason === 'name-collision'
        ? (value as BackupExportSourceDiagnostic)
        : undefined
    case 'limit-exceeded':
      return ['entry-count', 'resource-entries', 'entry-bytes', 'total-bytes', 'manifest-bytes', 'unknown'].includes(
        String(value.limit)
      )
        ? (value as BackupExportSourceDiagnostic)
        : undefined
    default:
      return undefined
  }
}

function exportSourceMessage(data: unknown): ExportSourceMessage {
  const diagnostic = exportSourceDiagnostic(data)
  if (!diagnostic) return { key: 'settings.data.backup.error.export_source' }

  switch (diagnostic.kind) {
    case 'source-changed':
      return diagnostic.path
        ? { key: 'settings.data.backup.error.export_source_changed_path', path: diagnostic.path }
        : { key: 'settings.data.backup.error.export_source_changed' }
    case 'non-regular':
      return diagnostic.path
        ? { key: 'settings.data.backup.error.export_source_non_regular_path', path: diagnostic.path }
        : { key: 'settings.data.backup.error.export_source_non_regular' }
    case 'unportable-path':
      if (diagnostic.reason === 'name-collision') {
        return diagnostic.path
          ? { key: 'settings.data.backup.error.export_source_collision_path', path: diagnostic.path }
          : { key: 'settings.data.backup.error.export_source_collision' }
      }
      return diagnostic.path
        ? { key: 'settings.data.backup.error.export_source_unportable_path', path: diagnostic.path }
        : { key: 'settings.data.backup.error.export_source_unportable' }
    case 'limit-exceeded':
      switch (diagnostic.limit) {
        case 'entry-count':
        case 'resource-entries':
          return { key: 'settings.data.backup.error.export_source_limit_count' }
        case 'entry-bytes':
          return { key: 'settings.data.backup.error.export_source_limit_entry' }
        case 'total-bytes':
          return { key: 'settings.data.backup.error.export_source_limit_total' }
        case 'manifest-bytes':
          return { key: 'settings.data.backup.error.export_source_limit_manifest' }
        case 'unknown':
          return { key: 'settings.data.backup.error.export_source_limit' }
      }
  }
}

const CompatibilityDetails: FC<{
  diagnostic: CompatibilityDiagnostic
  description: string
}> = ({ diagnostic, description }) => {
  const { t } = useTranslation()

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(compatibilityDiagnosticText(diagnostic))
      toast.success(t('settings.data.backup.compatibility.copied'))
    } catch {
      toast.error(t('settings.data.backup.compatibility.copy_failed'))
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-foreground leading-5">{description}</p>
      <p className="text-muted-foreground leading-5">{t('settings.data.backup.compatibility.nothing_changed')}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-border border-y py-2 text-xs">
        <dt className="text-muted-foreground">{t('settings.data.backup.compatibility.archive_app')}</dt>
        <dd className="min-w-0 break-all text-foreground">{diagnostic.archiveAppVersion ?? t('common.unknown')}</dd>
        <dt className="text-muted-foreground">{t('settings.data.backup.compatibility.current_app')}</dt>
        <dd className="min-w-0 break-all text-foreground">{diagnostic.currentAppVersion}</dd>
        <dt className="text-muted-foreground">{t('settings.data.backup.compatibility.archive_build')}</dt>
        <dd className="text-foreground">{t(BUILD_TYPE_KEYS[diagnostic.archiveBuildType])}</dd>
        {'sourceMigrationCount' in diagnostic ? (
          <>
            <dt className="text-muted-foreground">{t('settings.data.backup.compatibility.migrations')}</dt>
            <dd className="text-foreground">
              {t('settings.data.backup.compatibility.migration_counts', {
                archive: diagnostic.sourceMigrationCount,
                current: diagnostic.targetMigrationCount
              })}
            </dd>
            <dt className="text-muted-foreground">{t('settings.data.backup.compatibility.archive_tip')}</dt>
            <dd className="min-w-0 break-all font-mono text-foreground">
              {diagnostic.sourceTip.folderMillis}/{diagnostic.sourceTip.hashPrefix}
            </dd>
            <dt className="text-muted-foreground">{t('settings.data.backup.compatibility.current_tip')}</dt>
            <dd className="min-w-0 break-all font-mono text-foreground">
              {diagnostic.targetTip.folderMillis}/{diagnostic.targetTip.hashPrefix}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">{t('settings.data.backup.compatibility.format')}</dt>
            <dd className="text-foreground">
              {t('settings.data.backup.compatibility.format_versions', {
                archive: diagnostic.archiveFormatVersion,
                current: diagnostic.currentFormatVersion
              })}
            </dd>
          </>
        )}
      </dl>
      <div>
        <Button size="sm" variant="outline" onClick={() => void copyDiagnostics()}>
          <Copy className="size-3.5" />
          {t('settings.data.backup.compatibility.copy')}
        </Button>
      </div>
    </div>
  )
}

const BackupSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { checkForUpdates } = useManualUpdateCheck()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [running, setRunning] = useState<Running | null>(null)
  const activeOperation = running
    ? running.kind === 'export'
      ? 'export'
      : running.kind === 'prepare'
        ? 'prepare-restore'
        : null
    : status?.operation
  const busy = running !== null || activeOperation != null
  const knowledgeRebuildPending = status?.restore.kind === 'journal' && status.restore.knowledgeRebuildPending === true
  const statusPollingNeeded = status?.operation != null || knowledgeRebuildPending

  const refresh = useCallback(async () => {
    setStatus(await ipcApi.request('backup.get_status'))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!statusPollingNeeded) return
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh, statusPollingNeeded])

  /** Turn the closed IPC code set into the one sentence the user can act on. */
  const reportFailure = useCallback(
    async (error: unknown) => {
      if (!(error instanceof IpcError)) {
        toast.error(t('settings.data.backup.error.unexpected'))
        return
      }

      let diagnostic: CompatibilityDiagnostic | undefined
      if (
        error.code === backupErrorCodes.RESTORE_REQUIRES_NEWER_APP ||
        error.code === backupErrorCodes.RESTORE_LINEAGE_INCOMPATIBLE
      ) {
        diagnostic = compatibilityDiagnostic(error.data, ['source-ahead', 'lineage-fork'])
      } else if (error.code === backupErrorCodes.FORMAT_UNSUPPORTED) {
        diagnostic = compatibilityDiagnostic(error.data, ['archive-newer', 'archive-legacy'])
      }

      if (diagnostic) {
        const offerUpdate = canOfferUpdate(diagnostic)
        const title = t(
          diagnostic.kind === 'source-ahead'
            ? 'settings.data.backup.compatibility.ahead_title'
            : diagnostic.kind === 'lineage-fork'
              ? 'settings.data.backup.compatibility.fork_title'
              : 'settings.data.backup.compatibility.format_title'
        )
        const description =
          diagnostic.kind === 'source-ahead'
            ? t(
                offerUpdate
                  ? 'settings.data.backup.compatibility.ahead_update'
                  : 'settings.data.backup.compatibility.ahead_lineage',
                { count: diagnostic.missingMigrationCount }
              )
            : diagnostic.kind === 'lineage-fork'
              ? t('settings.data.backup.compatibility.fork_lineage')
              : t(
                  diagnostic.kind === 'archive-newer'
                    ? offerUpdate
                      ? 'settings.data.backup.compatibility.format_newer_update'
                      : 'settings.data.backup.compatibility.format_newer_lineage'
                    : 'settings.data.backup.compatibility.format_legacy',
                  {
                    archive: diagnostic.archiveFormatVersion,
                    current: diagnostic.currentFormatVersion
                  }
                )
        const content = <CompatibilityDetails diagnostic={diagnostic} description={description} />
        if (offerUpdate) {
          const confirmed = await popup.confirm({
            title,
            content,
            okText: t('settings.data.backup.compatibility.check_updates'),
            cancelText: t('common.close'),
            centered: true
          })
          if (confirmed) void checkForUpdates()
        } else {
          await popup.info({
            title,
            content,
            okText: t('common.close'),
            centered: true
          })
        }
        return
      }

      switch (error.code) {
        case backupErrorCodes.BUSY:
          return toast.error(t('settings.data.backup.error.busy'))
        case backupErrorCodes.ARCHIVE_REJECTED:
          return toast.error(t('settings.data.backup.error.archive_rejected'))
        case backupErrorCodes.RESTORE_STATE:
          return toast.error(t('settings.data.backup.error.restore_state'))
        case backupErrorCodes.JOURNAL_UNREADABLE:
          return toast.error(t('settings.data.backup.error.journal_unreadable'))
        case backupErrorCodes.ARM_FAILED:
          return toast.error(t('settings.data.backup.error.arm_failed'))
        case backupErrorCodes.ROLLBACK_UNAVAILABLE:
          return toast.error(t('settings.data.backup.error.rollback_unavailable'))
        case backupErrorCodes.RECOVERY_INCOMPLETE:
          return toast.error(t('settings.data.backup.error.recovery_incomplete'))
        case backupErrorCodes.STORAGE_UNAVAILABLE:
          return toast.error(t('settings.data.backup.error.storage_unavailable'))
        case backupErrorCodes.EXPORT_SOURCE: {
          const message = exportSourceMessage(error.data)
          return toast.error(message.path ? t(message.key, { path: message.path }) : t(message.key))
        }
        case backupErrorCodes.EXPORT_DESTINATION:
          return toast.error(t('settings.data.backup.error.export_destination'))
        case backupErrorCodes.RESTORE_RESOURCES:
          return toast.error(t('settings.data.backup.error.restore_resources'))
        default:
          return toast.error(t('settings.data.backup.error.unexpected'))
      }
    },
    [checkForUpdates, t]
  )

  /** One operation at a time, and the status is re-read whatever the outcome. */
  const run = useCallback(
    async (started: Running, work: () => Promise<void>) => {
      if (busy) return
      setRunning(started)
      try {
        await work()
      } catch (error) {
        await reportFailure(error)
      } finally {
        setRunning(null)
        await refresh()
      }
    },
    [busy, refresh, reportFailure]
  )

  /**
   * Ask main to abort the operation in flight. Deliberately NOT routed through
   * {@link run}: it exists to interrupt a busy service, so the busy guard that
   * protects every other action would block the only action that can end it.
   *
   * No confirmation toast — the abort is cooperative, so the row's button
   * returning to its idle label is the only honest signal that it actually
   * stopped, and that arrives on its own when the operation unwinds.
   */
  const handleCancelOperation = useCallback(async () => {
    try {
      await ipcApi.request('backup.cancel_operation')
      await refresh()
    } catch (error) {
      await reportFailure(error)
    }
  }, [refresh, reportFailure])

  const handleExport = () =>
    run({ kind: 'export' }, async () => {
      const result = await ipcApi.request('backup.export')
      if (result.status === 'canceled') return
      if (result.degradations.length > 0) {
        await popup.info({
          title: t('settings.data.backup.export.done_degraded_title'),
          content: (
            <DegradationDetails
              degradations={result.degradations}
              consequenceKey="settings.data.backup.export.done_degraded"
            />
          ),
          okText: t('common.close'),
          centered: true
        })
      } else {
        toast.success(t('settings.data.backup.export.done'))
      }
    })

  const handlePrepare = () =>
    run({ kind: 'prepare' }, async () => {
      const result = await ipcApi.request('backup.prepare_restore')
      if (result.status === 'canceled') return
      setPreview(result.preview)
    })

  const handleArm = () =>
    run({ kind: 'other' }, async () => {
      if (!preview) return
      const confirmed = await popup.confirm({
        title: t('settings.data.backup.restore.confirm_title'),
        content: (
          <div className="flex flex-col gap-3">
            <p>{t('settings.data.backup.restore.confirm_content')}</p>
            {preview.knowledge.rebuild > 0 && (
              <Alert
                type="warning"
                showIcon
                message={t('settings.data.backup.preview.knowledge_rebuild_cost', {
                  count: preview.knowledge.rebuild
                })}
              />
            )}
          </div>
        ),
        okText: t('settings.data.backup.restore.confirm_ok'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (!confirmed) return
      // Main atomically rejects the request if another window replaced this
      // preparation while the confirmation dialog was open.
      await ipcApi.request('backup.arm_restore', { restoreId: preview.restoreId })
    })

  const handleDiscard = () =>
    run({ kind: 'other' }, async () => {
      await ipcApi.request('backup.cancel_restore')
      setPreview(null)
      toast.success(t('settings.data.backup.restore.discarded'))
    })

  const handleRollback = () =>
    run({ kind: 'other' }, async () => {
      const confirmed = await popup.confirm({
        title: t('settings.data.backup.rollback.confirm_title'),
        content: t('settings.data.backup.rollback.confirm_content'),
        okText: t('settings.data.backup.rollback.confirm_ok'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (!confirmed) return
      // The app relaunches into the zero-connection rollback gate.
      await ipcApi.request('backup.rollback_restore')
    })

  /**
   * No confirmation on `abandon`: the button the user just pressed already says
   * it stops the rebuild and keeps the result, so a dialog repeating that adds
   * no information — and the outcome is recoverable by re-indexing later.
   */
  const acknowledge = (knowledgeRebuild: 'require-complete' | 'abandon') =>
    run({ kind: 'other' }, async () => {
      const result = await ipcApi.request('backup.acknowledge_restore', { knowledgeRebuild })
      if (!result.acknowledged) return
      toast.closeToast(BACKUP_RESTORE_NOTICE_KEY)
      toast.success(t('settings.data.backup.outcome.acknowledged'))
    })

  const handleAcknowledge = () => acknowledge('require-complete')
  const handleAbandonKnowledgeRebuild = () => acknowledge('abandon')

  const restore = status?.restore
  const journal = restore?.kind === 'journal' ? restore : null
  const hasPreparation = journal?.state === 'prepared'
  const hasMatchingPreview = hasPreparation && preview?.restoreId === journal.restoreId

  return (
    <SettingGroup theme={theme}>
      {/* Only the two operations the user waits on report progress; arm and
          rollback relaunch immediately and have nothing to show. */}
      <BackupProgressDialog
        open={activeOperation === 'export' || activeOperation === 'prepare-restore'}
        operation={activeOperation === 'export' || activeOperation === 'prepare-restore' ? activeOperation : null}
        onCancel={handleCancelOperation}
      />
      <SettingTitle>{t('settings.data.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <RowFlex className="shrink-0 justify-between gap-1.25">
          <AbortableAction
            label={
              <>
                <SaveIcon size={14} />
                {t('settings.general.backup.button')}
              </>
            }
            active={activeOperation === 'export'}
            busy={busy}
            onStart={handleExport}
            onCancel={handleCancelOperation}
          />
          <AbortableAction
            label={
              <>
                <FolderOpen size={14} />
                {t('settings.general.restore.button')}
              </>
            }
            active={activeOperation === 'prepare-restore'}
            busy={busy}
            onStart={handlePrepare}
            onCancel={handleCancelOperation}
          />
        </RowFlex>
      </SettingRow>
      <SettingHelpText>{t('settings.data.backup.export.credentials_warning')}</SettingHelpText>

      {hasMatchingPreview && <RestorePreviewCard preview={preview} />}

      {hasPreparation && (
        <>
          <SettingDivider />
          <RowFlex className="justify-end gap-2">
            <Button disabled={busy} onClick={handleDiscard}>
              {t('settings.data.backup.restore.discard_button')}
            </Button>
            {hasMatchingPreview && (
              <Button variant="destructive" disabled={busy} onClick={handleArm}>
                {t('settings.data.backup.restore.arm_button')}
              </Button>
            )}
          </RowFlex>
          {!hasMatchingPreview && (
            <SettingHelpText>{t('settings.data.backup.restore.pending_elsewhere')}</SettingHelpText>
          )}
        </>
      )}

      {restore && restore.kind !== 'none' && !hasPreparation && (
        <>
          <SettingDivider />
          <SettingRowTitle>{t('settings.data.backup.outcome.title')}</SettingRowTitle>
          <RestoreOutcome
            restore={restore}
            busy={busy}
            onRollback={handleRollback}
            onAcknowledge={handleAcknowledge}
            onAbandonKnowledgeRebuild={handleAbandonKnowledgeRebuild}
          />
        </>
      )}
    </SettingGroup>
  )
}

/**
 * A row's action button, which becomes that row's cancel button while its own
 * work is running.
 *
 * One control rather than two: an export or an archive admission can take
 * minutes, and the place the user looks for a way out is the button they just
 * pressed. Rows whose work is not running stay disabled, because the service
 * takes one operation at a time.
 */
const AbortableAction: FC<{
  label: ReactNode
  /** This row's operation is the one in flight. */
  active: boolean
  /** Some operation is in flight (this row's or another's). */
  busy: boolean
  onStart: () => void
  onCancel: () => void
}> = ({ label, active, busy, onStart, onCancel }) => {
  const { t } = useTranslation()

  if (active) {
    return (
      <Button variant="outline" aria-busy onClick={onCancel}>
        <Loader className="size-3.5 animate-spin motion-reduce:animate-none" />
        {t('common.cancel')}
      </Button>
    )
  }
  return (
    <Button variant="outline" disabled={busy} onClick={onStart}>
      {label}
    </Button>
  )
}

/**
 * The preview says only what is WRONG with this archive, plus the one warning
 * that the restore is destructive. Everything the pipeline counts when a restore
 * would go fine — coverage buckets, install/replace totals, "this archive was
 * migrated forward" — is deliberately absent: none of it changes the single
 * decision on this screen, which is to take the whole archive or not. Main still
 * measures and journals all of it, so support questions are answered from the
 * log rather than from the user's screen.
 */
const RestorePreviewCard: FC<{ preview: RestorePreview }> = ({ preview }) => {
  const { t } = useTranslation()

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border p-3">
      {preview.knowledge.ready > 0 && (
        <SettingHelpText>
          {t('settings.data.backup.preview.knowledge_ready', { count: preview.knowledge.ready })}
        </SettingHelpText>
      )}
      {preview.knowledge.rebuild > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('settings.data.backup.preview.knowledge_rebuild_cost', {
            count: preview.knowledge.rebuild
          })}
        />
      )}
      {preview.degradations.length > 0 && (
        <SettingHelpText>
          <DegradationDetails
            degradations={preview.degradations}
            consequenceKey="settings.data.backup.preview.degradations"
          />
        </SettingHelpText>
      )}
      <Alert type="warning" showIcon message={t('settings.data.backup.preview.destructive')} />
    </div>
  )
}

/**
 * The durable outcome of the last restore. `completed` offers the explicit
 * choice while both sides still exist: keep the restored state or move the
 * retained previous state back. Either terminal remains protected until its
 * displaced side is acknowledged and released.
 */
const RestoreOutcome: FC<{
  restore: NonNullable<BackupStatus['restore']>
  busy: boolean
  onRollback: () => void
  onAcknowledge: () => void
  onAbandonKnowledgeRebuild: () => void
}> = ({ restore, busy, onRollback, onAcknowledge, onAbandonKnowledgeRebuild }) => {
  const { t } = useTranslation()

  if (restore.kind === 'unreadable') {
    return <Alert type="error" showIcon message={t('settings.data.backup.outcome.unreadable')} />
  }
  if (restore.kind !== 'journal') return null

  // A repair that could not finish — in either direction — still owns the only
  // copy of what it moved, so the button that releases it is withheld rather
  // than shown and refused.
  const acknowledgeable =
    (restore.state === 'completed' ||
      restore.state === 'rolled-back' ||
      restore.state === 'failed' ||
      restore.state === 'expired') &&
    !restore.recoveryIncomplete &&
    !restore.resourcesIncomplete &&
    !restore.knowledgeRebuildPending
  const rollbackable = restore.state === 'completed' && !restore.resourcesIncomplete
  const knowledgeRebuildAbandonable =
    restore.state === 'completed' && restore.knowledgeRebuildPending === true && !restore.resourcesIncomplete

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t(RESTORE_STATE_KEYS[restore.state])}</SettingRowTitle>
        {(rollbackable || acknowledgeable || knowledgeRebuildAbandonable) && (
          <RowFlex className="gap-2">
            {rollbackable && (
              <Button variant="destructive" disabled={busy} onClick={onRollback}>
                {t('settings.data.backup.rollback.button')}
              </Button>
            )}
            {knowledgeRebuildAbandonable && (
              <Button disabled={busy} onClick={onAbandonKnowledgeRebuild}>
                {t('settings.data.backup.outcome.abandon_rebuild_button')}
              </Button>
            )}
            {acknowledgeable && (
              <Button disabled={busy} onClick={onAcknowledge}>
                {t(
                  restore.state === 'rolled-back'
                    ? 'settings.data.backup.outcome.keep_previous_button'
                    : 'settings.data.backup.outcome.acknowledge_button'
                )}
              </Button>
            )}
          </RowFlex>
        )}
      </SettingRow>
      {restore.state === 'completed' && (
        <SettingHelpText>{t('settings.data.backup.outcome.completed_help')}</SettingHelpText>
      )}
      {restore.state === 'rolled-back' && (
        <SettingHelpText>{t('settings.data.backup.outcome.rolled_back_help')}</SettingHelpText>
      )}
      {restore.state === 'completed' && (
        <SettingHelpText>{t('settings.data.backup.outcome.reconfirm_integrations')}</SettingHelpText>
      )}
      {restore.recoveryIncomplete && (
        <Alert type="warning" showIcon message={t('settings.data.backup.outcome.recovery_incomplete')} />
      )}
      {restore.resourcesIncomplete && (
        <Alert type="warning" showIcon message={t('settings.data.backup.outcome.resources_incomplete')} />
      )}
      {restore.knowledgeRebuildPending && (
        <Alert type="info" showIcon message={t('settings.data.backup.outcome.knowledge_rebuild_pending')} />
      )}
      {/*
        Completed only, and with the lines shown rather than just counted: this is
        the one moment the user can still act on what came back reduced, and only
        a completed restore actually put that data in front of them.
      */}
      {restore.state === 'completed' && restore.degradations && restore.degradations.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('settings.data.backup.outcome.degradations', {
            count: degradationCount(restore.degradations)
          })}
          description={<DegradationDetails degradations={restore.degradations} />}
        />
      )}
    </>
  )
}

export default BackupSettings
