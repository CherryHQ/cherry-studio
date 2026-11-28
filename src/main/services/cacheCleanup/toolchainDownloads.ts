import { application } from '@application'

import {
  type CleanupStepResult,
  type CleanupTarget,
  collectOwnedTargets,
  measurePaths,
  removeCleanupTarget,
  type SizeMeasurement
} from './shared'

function collectToolchainDownloadTargets() {
  const targets: CleanupTarget[] = [
    { item: 'mise_cache', path: application.getPath('feature.binary.data.cache'), kind: 'directory' },
    { item: 'npm_downloads', path: application.getPath('feature.binary.data.npm_cache'), kind: 'directory' },
    { item: 'aube_metadata', path: application.getPath('feature.binary.data.aube_metadata_cache'), kind: 'directory' }
  ]
  return collectOwnedTargets(targets)
}

export async function measureToolchainDownloadCaches(): Promise<SizeMeasurement> {
  const { targets, issues } = await collectToolchainDownloadTargets()
  const measurement = await measurePaths(targets)
  return { bytes: measurement.bytes, issues: [...issues, ...measurement.issues] }
}

export async function clearToolchainDownloadCaches(): Promise<CleanupStepResult[]> {
  const { targets, issues } = await collectToolchainDownloadTargets()
  const steps = issues.map((): CleanupStepResult => ({ state: 'skipped' }))
  if (targets.length === 0) return steps

  const removed = await application
    .get('BinaryManager')
    .tryClearDownloadCaches(() => Promise.all(targets.map(removeCleanupTarget)))
  return [...steps, ...(removed ?? [{ state: 'skipped' } as const])]
}
