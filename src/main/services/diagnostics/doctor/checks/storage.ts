import { application } from '@application'
import { getNormalizedExecutablePath, isUsableDataDir } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { cacheCleanupService } from '@main/services/cacheCleanup'
import type { CacheCleanupGroup } from '@shared/types/cacheCleanup'
import type { CacheCleanupRunResult } from '@shared/types/cacheCleanupIpc'
import { GB } from '@shared/utils/constants'
import { app } from 'electron'

import { defineDoctorCheck } from '../types'

const DISK_CRITICAL_BYTES = 1 * GB
const DISK_LOW_BYTES = 5 * GB
const DIAGNOSTIC_DATA_LARGE_BYTES = 200 * 1024 ** 2
const RECLAIMABLE_GROUPS = ['normal_cache', 'logs'] as const satisfies readonly CacheCleanupGroup[]

function cleanupOutcome(result: CacheCleanupRunResult) {
  const incomplete = result.results.find(({ status }) => !['cleared', 'not_found'].includes(status))
  return incomplete
    ? { status: 'failed' as const, message: `Cleanup group ${incomplete.group} was ${incomplete.status}` }
    : { status: 'fixed' as const }
}

/**
 * Preboot silently falls back to the default directory when the configured custom one is
 * unusable (see `resolveUserDataLocation`), so the app boots but the user's data looks lost.
 */
export const userDataLocation = defineDoctorCheck({
  id: 'storage-userdata-location',
  async run() {
    const actual = application.getPath('app.userdata')
    const configured = app.isPackaged
      ? bootConfigService.get('app.user_data_path')?.[getNormalizedExecutablePath()]
      : undefined
    if (!configured || configured === actual) return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'fallback_to_default' },
      actions: [
        { kind: 'open_path', path: actual },
        { kind: 'navigate', target: '/settings/data' }
      ],
      devMessage: 'Configured user data directory was unusable at boot; running on the default directory',
      evidence: [
        { key: 'configured', value: configured, dataClass: 'local_only' },
        { key: 'actual', value: actual, dataClass: 'local_only' },
        { key: 'configuredUsableNow', value: isUsableDataDir(configured), dataClass: 'public' }
      ]
    }
  },
  fixes: {}
})

export const diskSpace = defineDoctorCheck({
  id: 'storage-disk-space',
  async run() {
    const health = await application.get('StorageMonitorService').refreshHealth()
    if (health.freeBytes >= DISK_LOW_BYTES) return { status: 'pass' }

    const inspection = await cacheCleanupService.inspect([...RECLAIMABLE_GROUPS])
    const normalCacheBytes = inspection.results.find(({ group }) => group === 'normal_cache')?.size.bytes ?? 0
    const diagnosticDataBytes = inspection.results.find(({ group }) => group === 'logs')?.size.bytes ?? 0
    const reclaimableBytes = normalCacheBytes + diagnosticDataBytes
    const critical = health.freeBytes < DISK_CRITICAL_BYTES
    return {
      status: critical ? 'fail' : 'warn',
      attribution: 'user-fixable',
      detail: {
        variant: critical ? 'critical' : 'low',
        params: {
          freeBytes: health.freeBytes,
          totalBytes: health.totalBytes,
          reclaimableBytes,
          normalCacheBytes,
          diagnosticDataBytes
        }
      },
      actions: [{ kind: 'fix', fixId: 'cleanup' }],
      evidence: [
        { key: 'freeBytes', value: health.freeBytes, dataClass: 'public' },
        { key: 'totalBytes', value: health.totalBytes, dataClass: 'public' },
        { key: 'reclaimableBytes', value: reclaimableBytes, dataClass: 'public' },
        { key: 'normalCacheBytes', value: normalCacheBytes, dataClass: 'public' },
        { key: 'diagnosticDataBytes', value: diagnosticDataBytes, dataClass: 'public' }
      ]
    }
  },
  fixes: {
    async cleanup() {
      return cleanupOutcome(await cacheCleanupService.run([...RECLAIMABLE_GROUPS]))
    }
  }
})

export const diagnosticDataSize = defineDoctorCheck({
  id: 'storage-diagnostic-data-size',
  async run() {
    const inspection = await cacheCleanupService.inspect(['logs'])
    const size = inspection.results[0]?.size
    if (
      !size ||
      size.bytes === null ||
      (size.completeness === 'partial' && size.bytes <= DIAGNOSTIC_DATA_LARGE_BYTES)
    ) {
      throw new Error('Diagnostic data size is unavailable')
    }
    if (size.bytes <= DIAGNOSTIC_DATA_LARGE_BYTES) return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'large', params: { bytes: size.bytes } },
      actions: [{ kind: 'fix', fixId: 'clear' }],
      evidence: [{ key: 'bytes', value: size.bytes, dataClass: 'public' }]
    }
  },
  fixes: {
    async clear() {
      return cleanupOutcome(await cacheCleanupService.run(['logs']))
    }
  }
})
