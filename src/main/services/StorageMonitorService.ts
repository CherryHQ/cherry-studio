import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { StorageHealth, StorageHealthLevel } from '@shared/types/storageMonitor'
import { GB } from '@shared/utils/constants'
import { statfs } from 'fs/promises'

const logger = loggerService.withContext('StorageMonitorService')

const MINUTE = 1000 * 60

/**
 * Warn when free space on the user-data volume drops below this. Matches GNOME's
 * `free-size-gb-no-notify=1` default — below ~1 GiB, writes start risking failure.
 */
export const STORAGE_LOW_THRESHOLD_BYTES = 1 * GB

/**
 * Capacity-adaptive poll interval: the less free space, the more frequently we
 * check, so we both warn promptly as the disk fills and auto-dismiss promptly
 * once it is freed. Monotonic and bounded to [5min, 60min].
 */
export function intervalForFree(freeBytes: number): number {
  if (freeBytes >= 20 * GB) return 60 * MINUTE
  if (freeBytes >= 10 * GB) return 30 * MINUTE
  if (freeBytes >= 5 * GB) return 15 * MINUTE
  if (freeBytes >= 1 * GB) return 10 * MINUTE
  return 5 * MINUTE
}

/**
 * Monitors free disk space on the volume hosting Cherry Studio's user-data
 * directory (where the SQLite database lives) and warns the main window when it
 * runs low.
 *
 * Detection lives in main because the disk is a main-owned resource: a single
 * capacity-adaptive timer replaces the former renderer-driven polling, and only
 * health transitions (ok <-> low) are pushed — to the main window only.
 */
@Injectable('StorageMonitorService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class StorageMonitorService extends BaseService {
  private health: StorageHealth = { level: 'ok', freeBytes: 0, totalBytes: 0, checkedAt: 0 }
  private intervalDisposable: Disposable | null = null
  private currentIntervalMs = 0

  protected onInit(): void {
    // Renderer pulls the current health on mount to seed its initial state,
    // closing the startup race where the first transition push could precede
    // the renderer subscription.
    this.ipcHandle(IpcChannel.StorageMonitor_GetHealth, () => this.health)
  }

  protected onReady(): void {
    // Fire-and-forget: the first poll runs in the background like every
    // subsequent registerInterval tick — disk monitoring must not gate boot.
    void this.check()
  }

  private async check(): Promise<void> {
    try {
      const stats = await statfs(application.getPath('app.userdata'))
      // bavail = blocks available to a non-privileged process (the bytes we can
      // actually write); @types/node's StatsFs has no frsize, so use bsize.
      this.applyHealth(stats.bsize * stats.bavail, stats.bsize * stats.blocks)
    } catch (error) {
      // A transient statfs failure must not flip the warning state; keep the
      // last-known health and simply retry on the next tick.
      logger.error('Failed to read disk space via statfs', error as Error)
    } finally {
      // Always keep a timer alive, even after a read error, so monitoring never
      // silently dies.
      this.scheduleNext()
    }
  }

  private applyHealth(freeBytes: number, totalBytes: number): void {
    const level: StorageHealthLevel = freeBytes < STORAGE_LOW_THRESHOLD_BYTES ? 'low' : 'ok'
    const previousLevel = this.health.level
    this.health = { level, freeBytes, totalBytes, checkedAt: Date.now() }

    if (level !== previousLevel) {
      logger.info(`Disk space health changed: ${previousLevel} -> ${level}`, { freeBytes, totalBytes })
      application
        .get('WindowManager')
        .broadcastToType(WindowType.Main, IpcChannel.StorageMonitor_HealthChanged, this.health)
    }
  }

  /**
   * Re-arm the timer at the interval that matches the current free space. Same
   * band => keep the existing timer (no churn); band change => dispose and
   * re-register at the new interval (mirrors ProxyManager's pattern).
   */
  private scheduleNext(): void {
    const nextMs = intervalForFree(this.health.freeBytes)
    if (this.intervalDisposable && nextMs === this.currentIntervalMs) {
      return
    }
    this.intervalDisposable?.dispose()
    this.currentIntervalMs = nextMs
    this.intervalDisposable = this.registerInterval(() => this.check(), nextMs)
  }
}
