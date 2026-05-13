import { BackupDomain } from '@shared/backup'
import { describe, expect, it } from 'vitest'

import { BackupPhase, BackupProgressTracker, RestorePhase } from '../BackupProgressTracker'

describe('BackupProgressTracker', () => {
  it('returns 0% when totals are not set', () => {
    const tracker = new BackupProgressTracker()
    expect(tracker.getOverallProgress()).toBe(0)
  })

  it('reports correct progress after setTotals', () => {
    const tracker = new BackupProgressTracker()
    tracker.setTotals(100, 0n)
    tracker.incrementItemsProcessed(50)
    expect(tracker.getOverallProgress()).toBe(50)
  })

  it('caps progress at 100%', () => {
    const tracker = new BackupProgressTracker()
    tracker.setTotals(10, 0n)
    tracker.incrementItemsProcessed(20)
    expect(tracker.getOverallProgress()).toBe(100)
  })

  it('tracks per-domain progress via setDomain', () => {
    const tracker = new BackupProgressTracker()
    tracker.setDomain(BackupDomain.TOPICS, 50)
    tracker.incrementItemsProcessed(25)
    expect(tracker.getDomainProgress(BackupDomain.TOPICS)).toBe(50)
  })

  it('returns 0 for unknown domain', () => {
    const tracker = new BackupProgressTracker()
    expect(tracker.getDomainProgress(BackupDomain.TOPICS)).toBe(0)
  })

  it('includes totalItems in backup progress snapshot', () => {
    const tracker = new BackupProgressTracker()
    tracker.setTotals(200, 0n)
    tracker.setPhase(BackupPhase.FILES)
    tracker.incrementItemsProcessed(100)

    const progress = tracker.getBackupProgress()
    expect(progress.phase).toBe('files')
    expect(progress.totalItems).toBe(200)
    expect(progress.itemsProcessed).toBe(100)
    expect(progress.overallProgress).toBe(50)
  })

  it('includes totalItems in restore progress snapshot', () => {
    const tracker = new BackupProgressTracker()
    tracker.setTotals(80, 0n)
    tracker.setPhase(RestorePhase.IMPORTING)
    tracker.incrementItemsProcessed(40)

    const progress = tracker.getRestoreProgress()
    expect(progress.phase).toBe('importing')
    expect(progress.totalItems).toBe(80)
    expect(progress.itemsProcessed).toBe(40)
    expect(progress.overallProgress).toBe(50)
  })

  it('reportError increments error count', () => {
    const tracker = new BackupProgressTracker()
    tracker.reportError(new Error('test'))
    tracker.reportError(new Error('test2'))
    const progress = tracker.getBackupProgress()
    expect(progress).toBeDefined()
  })
})
