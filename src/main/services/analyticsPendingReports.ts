import fs from 'node:fs'

import { omit } from 'es-toolkit'
import { validate as isUuid, v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { loggerService } from '@logger'
import { bootConfigService } from '@main/data/bootConfig'
import { isDataCollectionConsented } from '@main/utils/privacyConsent'
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BackupAnalyticsTarget } from '@shared/ipc/schemas/analytics'

import type { MainAnalyticsEvent } from './analyticsEvents'

const logger = loggerService.withContext('AnalyticsPendingReports')

const PENDING_REPORTS_KEY = 'temp.analytics.pending_reports'
const MAX_PENDING_REPORTS = 20

type PendingReport = BootConfigSchema[typeof PENDING_REPORTS_KEY][number]
type ReadyReport = Extract<MainAnalyticsEvent, { event: 'restore_run' | 'data_relocation_run' }>

const isStagedRestore = (report: PendingReport) => report.event === 'restore_run' && report.status === 'staged'
const isStaged = (report: PendingReport) => report.status === 'staged'

function writeReports(reports: PendingReport[]): void {
  try {
    bootConfigService.set(PENDING_REPORTS_KEY, reports.slice(-MAX_PENDING_REPORTS))
  } catch (error) {
    logger.warn('Pending analytics report not saved', error as Error)
  }
}

// Decided when the work ends, like any other event: turning collection on later must not send it.
function consented(): boolean {
  try {
    const preferences = application.get('PreferenceService')
    return isDataCollectionConsented(
      preferences.get('app.privacy.data_collection.enabled'),
      preferences.get('app.privacy.policy_version')
    )
  } catch {
    return false
  }
}

/** Keeps a result for the next launch; a relaunch right after flushes boot config on its way out. */
export function queuePendingReport(report: PendingReport): void {
  if (!consented()) return
  writeReports([...bootConfigService.get(PENDING_REPORTS_KEY), report])
}

export function queueStagedRestore(target: BackupAnalyticsTarget): void {
  queuePendingReport({ event: 'restore_run', target, status: 'staged' })
  // The restore swaps in the backup's database, which holds that device's client id. Reading the id must not
  // write it: the restore journal has already fingerprinted the database, so a new id waits in this profile's file.
  try {
    const current = application.get('PreferenceService').get('app.user.id')
    fs.writeFileSync(application.getPath('app.restore_client_id_file'), isUuid(current) ? current : uuidv4())
  } catch (error) {
    logger.warn('Client id not kept across restore', error as Error)
  }
}

/** Stages a relocation when the user asks for it; preboot, which cannot read consent, only settles it. */
export function queueStagedRelocation(taskId: string, copy: boolean): void {
  queuePendingReport({ event: 'data_relocation_run', copy, status: 'staged', taskId })
}

/**
 * Records how a staged relocation went; a later outcome of the same relocation (e.g. abandoned) follows it.
 * Only the relocation staged under `taskId` settles: one started without consent has no entry.
 */
export function settleRelocation(taskId: string, status: 'completed' | 'failed' | 'abandoned'): void {
  const reports = [...bootConfigService.get(PENDING_REPORTS_KEY)]
  const index = reports.findLastIndex((report) => report.event === 'data_relocation_run' && report.taskId === taskId)
  const relocation = reports[index]
  if (relocation?.event !== 'data_relocation_run') return
  if (relocation.status === 'staged') reports[index] = { ...relocation, status }
  else reports.push({ ...relocation, status })
  writeReports(reports)
}

/** Puts this device's own client id back after a restore; call before anything reads the id. */
export async function restoreKeptClientId(): Promise<void> {
  const file = application.getPath('app.restore_client_id_file')
  let kept: string
  try {
    kept = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  fs.rmSync(file, { force: true })
  if (isUuid(kept)) await application.get('PreferenceService').set('app.user.id', kept)
}

/** Settles the latest staged restore; with none staged (collection was off, or an older build) nothing is sent. */
export function settlePendingRestore(status: 'completed' | 'failed'): void {
  const reports = [...bootConfigService.get(PENDING_REPORTS_KEY)]
  const index = reports.findLastIndex(isStagedRestore)
  if (index === -1) return
  reports[index] = { ...reports[index], status }
  writeReports(reports)
}

/** Removes and returns the reports ready to send; staged work waits for its outcome. */
export function takePendingReports(): ReadyReport[] {
  const reports = bootConfigService.get(PENDING_REPORTS_KEY)
  const ready = reports.filter((report) => !isStaged(report))
  if (ready.length > 0) writeReports(reports.filter(isStaged))
  // The task id only pairs outcomes with their request; it is not part of the event.
  return ready.map((report) => omit(report as ReadyReport & { taskId?: string }, ['taskId']) as ReadyReport)
}
