import path from 'node:path'

import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { buildLaunchOverlay, type OverlayFile, reclaimLaunchOverlays, reconcileLaunchOverlay } from './launchOverlay'

const logger = loggerService.withContext('LocalAgentOverlayService')

export interface LaunchOverlay {
  home: string
  dispose(): Promise<void>
}

/**
 * Owns the per-launch homes Cherry gives local CLIs: reconciles leftovers of an abnormal exit at
 * startup and releases every live overlay and terminal lease at shutdown.
 */
@Injectable('LocalAgentOverlayService')
@ServicePhase(Phase.WhenReady)
export class LocalAgentOverlayService extends BaseService {
  private readonly live = new Map<string, Promise<void> | undefined>()
  private readonly retained = new Set<{ dispose(): Promise<void> }>()

  protected async onInit() {
    await reclaimLaunchOverlays(application.getPath('feature.agents.launch_overlays'), new Set(this.live.keys()))
  }

  protected async onStop() {
    const leases = [...this.retained]
    this.retained.clear()
    await Promise.allSettled(leases.map((lease) => lease.dispose()))
    await Promise.allSettled([...this.live.keys()].map((dir) => this.release(dir)))
  }

  /** A launch home sharing `realHome`'s entries plus `files`; without `realHome` it is a private directory. */
  async create(realHome: string | undefined, files: readonly OverlayFile[]): Promise<LaunchOverlay> {
    const dir = path.join(application.getPath('feature.agents.launch_overlays'), uuidv4())
    this.live.set(dir, undefined)
    try {
      const home = await buildLaunchOverlay(dir, realHome, files)
      return { home, dispose: () => this.release(dir) }
    } catch (error) {
      await this.release(dir)
      throw error
    }
  }

  /** Keeps a launch's binding until shutdown, for processes Cherry cannot observe exiting (terminals). */
  retainUntilStop(lease: { dispose(): Promise<void> }) {
    this.retained.add(lease)
  }

  private release(dir: string): Promise<void> {
    if (!this.live.has(dir)) return Promise.resolve()
    let releasing = this.live.get(dir)
    if (!releasing) {
      releasing = reconcileLaunchOverlay(dir)
        .catch((error: unknown) => logger.warn('Failed to reconcile a launch overlay', { dir, error }))
        .finally(() => this.live.delete(dir))
      this.live.set(dir, releasing)
    }
    return releasing
  }
}
