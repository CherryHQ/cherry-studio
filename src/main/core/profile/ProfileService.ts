import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { CHERRY_HOME } from '@main/core/paths/constants'
import { WindowType } from '@main/core/window/types'
import { WINDOW_TYPE_REGISTRY } from '@main/core/window/windowRegistry'

import {
  addProfile,
  findEntry,
  generateProfileId,
  type ProfileEntry,
  renameProfile as renameInRegistry,
  resolveProfileRoots,
  setActive
} from './profileRegistry'
import { readProfileRegistry, writeProfileRegistry } from './profileStore'

const logger = loggerService.withContext('ProfileService')

/** A profile switch failed before commit and the previous profile was restored. */
export class ProfileSwitchError extends Error {
  override name = 'ProfileSwitchError'
}

/** A profile switch failed AND the rollback to the previous profile also failed — the app must restart. */
export class ProfileSwitchFatalError extends Error {
  override name = 'ProfileSwitchFatalError'
}

/**
 * Owns the profile registry (profiles.json) and the runtime switch (RFC §4.4).
 * App-global — it drives the switch and is not itself a profile participant.
 */
@Injectable('ProfileService')
@ServicePhase(Phase.WhenReady)
export class ProfileService extends BaseService {
  private switching = false
  private readonly _onProfileDidSwitch = new Emitter<string>()
  /** Fires with the new active profile id after a switch commits. */
  public readonly onProfileDidSwitch: Event<string> = this._onProfileDidSwitch.event

  /** Whether a profile switch is currently in flight. */
  public isSwitching(): boolean {
    return this.switching
  }

  public getActiveProfileId(): string {
    return readProfileRegistry().activeProfileId
  }

  public listProfiles(): ProfileEntry[] {
    return [...readProfileRegistry().profiles]
  }

  /** Create a new isolated profile (does not switch to it). */
  public createProfile(name: string): ProfileEntry {
    const registry = readProfileRegistry()
    const id = generateProfileId(new Set(registry.profiles.map((entry) => entry.id)))
    const entry: ProfileEntry = { id, dataDir: `Profiles/${id}`, name, createdAt: Date.now() }
    writeProfileRegistry(addProfile(registry, entry))
    logger.info('Profile created', { id, name })
    return entry
  }

  public renameProfile(id: string, name: string): void {
    writeProfileRegistry(renameInRegistry(readProfileRegistry(), id, name))
    logger.info('Profile renamed', { id, name })
  }

  /**
   * Switch the active profile at runtime (RFC §4.4): deactivate all participants
   * (reverse order), repoint the path slot, activate all (forward), commit the
   * pointer, reset the renderer, and fire. On any pre-commit failure the previous
   * profile is restored by re-activating it (convergent — no hand-written inverse).
   */
  public async switchProfile(targetId: string): Promise<void> {
    if (this.switching) throw new ProfileSwitchError('A profile switch is already in progress')
    const registry = readProfileRegistry()
    const target = findEntry(registry, targetId)
    if (!target) throw new ProfileSwitchError(`Unknown profile: ${targetId}`)
    const previousId = registry.activeProfileId
    if (previousId === targetId) return
    const previous = findEntry(registry, previousId)

    this.switching = true
    try {
      await application.deactivateProfile() // step 2: writers first, DbService last
      this.repointPaths(target) // step 3
      await application.activateProfile({ profileId: targetId }) // step 4: DbService first
      await this.runRecovery(targetId) // step 4b: re-arm owners that recover after activation
      writeProfileRegistry(setActive(registry, targetId)) // step 5: commit (disk pointer moves only here)
    } catch (error) {
      await this.rollbackTo(previous, previousId)
      this.switching = false
      logger.error('Profile switch failed; rolled back to previous', error as Error, { targetId, previousId })
      throw new ProfileSwitchError(`Failed to switch to profile ${targetId} (restored ${previousId})`)
    }

    // Post-commit (step 6–7): the profile has switched; renderer reset is
    // best-effort and does not roll back.
    try {
      await this.resetRenderer()
    } catch (error) {
      logger.error('Renderer reset after profile switch failed', error as Error, { targetId })
    }
    this._onProfileDidSwitch.fire(targetId)
    this.switching = false
    logger.info('Profile switch complete', { targetId, previousId })
  }

  /** Best-effort post-activation recovery for owners that re-arm the new profile's work. */
  private async runRecovery(profileId: string): Promise<void> {
    try {
      await application.get('JobManager').recoverActiveProfile()
    } catch (error) {
      logger.error('Profile switch: job recovery failed', error as Error, { profileId })
    }
    // After the job queue is re-armed, recover the new profile's interrupted/deleting
    // knowledge items (deleting-item recovery enqueues jobs, so it must follow the above).
    try {
      application.get('KnowledgeService').recoverActiveProfile()
    } catch (error) {
      logger.error('Profile switch: knowledge recovery failed', error as Error, { profileId })
    }
  }

  private repointPaths(entry: ProfileEntry): void {
    const roots = resolveProfileRoots(entry, application.getPath('app.userdata'), CHERRY_HOME)
    application.setProfilePathRegistry(roots.profileRoot, roots.credentialRoot)
  }

  /** Restore the previous profile: release the target in reverse order, then acquire previous. */
  private async rollbackTo(previous: ProfileEntry | undefined, previousId: string): Promise<void> {
    try {
      // Release the target's resources FIRST, in reverse order (writers before DbService).
      // activateProfile alone is convergent but applies release-then-acquire per participant
      // in FORWARD order, so DbService would reopen the previous DB before still-bound writers
      // (JobManager) release — letting recovery-armed target jobs settle into the previous
      // profile's DB. A full deactivate first drains those writers against the target's DB.
      await application.deactivateProfile()
      if (previous) this.repointPaths(previous)
      await application.activateProfile({ profileId: previousId })
      // Symmetric with the happy path (step 4b): re-arm the restored profile's
      // jobs/schedules, which deactivate disposed — otherwise a failed switch
      // leaves the previous profile's recurring jobs silently dead until restart.
      await this.runRecovery(previousId)
    } catch (fatal) {
      logger.error('Profile switch rollback failed — restart required', fatal as Error, { previousId })
      throw new ProfileSwitchFatalError(`Rollback to profile ${previousId} failed; restart the app`)
    }
  }

  private async resetRenderer(): Promise<void> {
    const wm = application.get('WindowManager')
    // Close every non-main window so none stays bound to the previous profile
    // (RFC §4.5 / design §9): pooled types drain their standby via suspendPool,
    // then in-use instances close; singletons close directly. Otherwise a secondary
    // window serves old-profile data against the switched DB, and its beforeunload
    // can re-write the persist cache the reloaded main window just cleared.
    for (const [type, meta] of Object.entries(WINDOW_TYPE_REGISTRY)) {
      const windowType = type as WindowType
      if (windowType === WindowType.Main || !meta) continue
      if (meta.lifecycle === 'pooled') wm.suspendPool(windowType)
      for (const win of wm.getWindowsByType(windowType)) {
        const id = wm.getWindowId(win)
        if (id) wm.close(id)
      }
    }
    // Reload the main window onto the new profile, clearing its persisted cache so
    // per-profile ids do not leak across the switch.
    await application.get('MainWindowService').reloadMainWindow({ clearPersistCache: true })
  }
}
