import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { CHERRY_HOME } from '@main/core/paths/constants'

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
      this.resetRenderer()
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
  }

  private repointPaths(entry: ProfileEntry): void {
    const roots = resolveProfileRoots(entry, application.getPath('app.userdata'), CHERRY_HOME)
    application.setProfilePathRegistry(roots.profileRoot, roots.credentialRoot)
  }

  /** Restore the previous profile by re-activating it — convergent, so it reaches previous from any partial state. */
  private async rollbackTo(previous: ProfileEntry | undefined, previousId: string): Promise<void> {
    try {
      if (previous) this.repointPaths(previous)
      await application.activateProfile({ profileId: previousId })
    } catch (fatal) {
      logger.error('Profile switch rollback failed — restart required', fatal as Error, { previousId })
      throw new ProfileSwitchFatalError(`Rollback to profile ${previousId} failed; restart the app`)
    }
  }

  private resetRenderer(): void {
    application.get('MainWindowService').reloadMainWindow()
  }
}
