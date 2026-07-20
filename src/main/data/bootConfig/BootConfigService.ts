/**
 * Boot configuration service for main process.
 * Handles boot-config.json read/write with sync loading and debounced saving.
 *
 * Uses a flat key-value map (not nested objects).
 * Keys are strings like 'app.disable_hardware_acceleration'.
 */

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { BOOT_CONFIG_PATH } from '@main/core/paths/constants'
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import { bootConfigSchema, DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'
import { app } from 'electron'

import type { BootConfigLoadError } from './types'

const logger = loggerService.withContext('BootConfigService')

/** Debounce delay for saving config (ms) */
const SAVE_DEBOUNCE_MS = 350

/** Payload for boot config change notifications */
interface BootConfigChangePayload<K extends BootConfigKey = BootConfigKey> {
  key: K
  value: BootConfigSchema[K]
  previousValue?: BootConfigSchema[K]
}

/** Listener function for boot config changes */
type BootConfigChangeListener<K extends BootConfigKey = BootConfigKey> = (payload: BootConfigChangePayload<K>) => void

/**
 * Boot configuration service.
 * Initializes synchronously on module import.
 */
export class BootConfigService {
  private config: BootConfigSchema
  private readonly filePath: string
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** True when in-memory config has changes not yet persisted to disk. */
  private dirty = false
  private listeners = new Map<BootConfigKey, Set<BootConfigChangeListener>>()
  private loadError: BootConfigLoadError | null = null

  constructor() {
    // Stored under ~/.cherrystudio/ rather than userData so that:
    // 1. It survives a custom appDataPath setting (boot config decides where userData is, not the other way around).
    // 2. It can be read before initAppDataDir() rewrites the userData path.
    // BOOT_CONFIG_PATH is sourced from @main/core/paths/constants — a zero-dependency
    // module specifically extracted so this service can avoid heavier imports.
    this.filePath = BOOT_CONFIG_PATH
    this.config = this.loadSync()
  }

  /**
   * Get configuration value by key.
   */
  public get<K extends BootConfigKey>(key: K): BootConfigSchema[K] {
    return this.config[key]
  }

  /**
   * Get entire configuration object.
   */
  public getAll(): BootConfigSchema {
    return { ...this.config }
  }

  /**
   * Set configuration value by key (auto-saves with debounce).
   *
   * THROWS on a value that fails schema validation, before any state change.
   * Callers are typed, but values also arrive from untrusted runtime inputs
   * (the Preference IPC route, v1 data in BootConfigMigrator) — the throw is
   * the single enforcement point for all of them.
   */
  public set<K extends BootConfigKey>(key: K, value: BootConfigSchema[K]): void {
    const parsed = bootConfigSchema.shape[key].safeParse(value)
    if (!parsed.success) {
      throw new Error(`Invalid boot config value for "${key}": ${parsed.error.message}`)
    }
    const validValue = parsed.data as BootConfigSchema[K]
    const previousValue = this.config[key]
    this.config[key] = validValue
    this.dirty = true
    this.scheduleSave()
    this.notifyListeners(key, validValue, previousValue)
  }

  /**
   * Reset configuration to defaults.
   * Deletes the config file (it will be recreated on next save).
   */
  public reset(): void {
    const previousConfig = this.config
    this.config = { ...DefaultBootConfig }

    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath)
    }

    this.loadError = null
    logger.info('Boot config reset to defaults')

    for (const key of Object.keys(previousConfig) as BootConfigKey[]) {
      this.notifyListeners(key, this.config[key], previousConfig[key])
    }
  }

  /**
   * Persist the current in-memory config to disk, replacing the invalid file,
   * and clear the load error.
   *
   * Recovery action for `validation_error`: after a per-key validation load,
   * memory holds the valid keys plus defaults for the rejected ones — unlike
   * {@link reset}, repairing keeps the valid keys (one corrupt flag must not
   * erase a valid `app.user_data_path`). Strict write like {@link persist}:
   * THROWS on fs failure, with the dirty flag and load error retained.
   */
  public repair(): void {
    this.dirty = true
    this.persist()
    this.loadError = null
    logger.info('Boot config repaired: valid keys persisted, invalid keys reset to defaults')
  }

  /**
   * Get the load error if one occurred during initialization.
   */
  public getLoadError(): BootConfigLoadError | null {
    return this.loadError
  }

  /**
   * Check if a load error occurred during initialization.
   */
  public hasLoadError(): boolean {
    return this.loadError !== null
  }

  /**
   * Clear the load error.
   */
  public clearLoadError(): void {
    this.loadError = null
  }

  /**
   * Get config file path.
   */
  public getFilePath(): string {
    return this.filePath
  }

  /**
   * Subscribe to configuration changes for a specific key.
   * @returns Unsubscribe function
   */
  public onChange<K extends BootConfigKey>(key: K, listener: BootConfigChangeListener<K>): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(listener as BootConfigChangeListener)

    return () => {
      this.listeners.get(key)?.delete(listener as BootConfigChangeListener)
    }
  }

  /**
   * Persist pending changes to disk immediately, **propagating failures**.
   *
   * Cancels the debounced auto-save and writes synchronously. THROWS if the
   * write (atomic temp-file `writeFileSync` + `renameSync`, or the all-defaults
   * `unlinkSync`) fails, so callers that need a hard durability guarantee — the
   * v1→v2 migrator, or an IPC handler that must not report success before the
   * change is on disk — can observe and react to the failure.
   *
   * No-op when there are no unsaved changes. On failure the dirty flag is
   * retained so a later {@link persist}/{@link flush} can retry.
   *
   * Use {@link flush} instead when a failed write is tolerable (best-effort).
   */
  public persist(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.dirty) return
    this.writeToDisk()
    this.dirty = false
  }

  /**
   * Persist pending changes to disk immediately, **best-effort**.
   *
   * A convenience wrapper around {@link persist} for callers that want pending
   * writes committed but do not care whether the write actually succeeded — e.g.
   * shutdown, or preboot paths where a thrown error would crash startup. NEVER
   * throws: any failure is logged and swallowed, and the dirty flag is retained
   * so a later {@link persist}/{@link flush} can retry.
   *
   * Callers that must KNOW whether the data reached disk must use
   * {@link persist} instead.
   */
  public flush(): void {
    try {
      this.persist()
    } catch (error) {
      logger.error(`Failed to flush boot config to ${this.filePath}`, error as Error)
    }
  }

  /**
   * Notify listeners of a configuration change.
   */
  private notifyListeners<K extends BootConfigKey>(
    key: K,
    value: BootConfigSchema[K],
    previousValue?: BootConfigSchema[K]
  ): void {
    const listeners = this.listeners.get(key)
    if (!listeners) return

    const payload: BootConfigChangePayload<K> = { key, value, previousValue }

    for (const listener of listeners) {
      try {
        ;(listener as BootConfigChangeListener<K>)(payload)
      } catch (error) {
        logger.error(`Error in boot config change listener for key "${key}"`, error as Error)
      }
    }
  }

  /**
   * Synchronously load config from file.
   * Records any errors to loadError for later handling.
   */
  private loadSync(): BootConfigSchema {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger.info(`Boot config file not found at ${this.filePath}, using defaults`)
        return { ...DefaultBootConfig }
      }

      const content = fs.readFileSync(this.filePath, 'utf-8')

      try {
        const parsed = JSON.parse(content)
        const { config, invalidKeys, invalidRoot } = this.mergeDefaults(parsed)
        if (invalidRoot || invalidKeys.length > 0) {
          const message = invalidRoot
            ? 'root value is not an object'
            : `values failed schema validation: ${invalidKeys.join(', ')}`
          this.loadError = {
            type: 'validation_error',
            message,
            filePath: this.filePath,
            invalidKeys
          }
          logger.error(
            `Boot config file ${this.filePath} contains invalid data (${message}); affected keys reset to defaults`
          )
        } else {
          logger.info(`Boot config loaded from ${this.filePath}`)
        }
        return config
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError)
        this.loadError = {
          type: 'parse_error',
          message: errorMessage,
          filePath: this.filePath,
          rawContent: content
        }
        logger.error(`Failed to parse boot config file ${this.filePath}: ${errorMessage}`)
        return { ...DefaultBootConfig }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.loadError = {
        type: 'read_error',
        message: errorMessage,
        filePath: this.filePath
      }
      logger.error(`Failed to read boot config file ${this.filePath}: ${errorMessage}`)
      return { ...DefaultBootConfig }
    }
  }

  /**
   * Schedule debounced save.
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      // Auto-save is best-effort: it runs from a timer callback, so a failure
      // must not throw (that would be an unhandled exception). Log and keep the
      // dirty flag so a later persist()/flush() can retry.
      try {
        this.persist()
      } catch (error) {
        logger.error(`Failed to auto-save boot config to ${this.filePath}`, error as Error)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Synchronously write config to file (atomic write via temp file + rename).
   * Only writes keys that differ from defaults. Deletes file if all values are
   * defaults. THROWS on any fs failure — the error strategy is owned by the
   * callers: {@link persist} propagates, {@link flush} and the debounced
   * auto-save swallow and log.
   */
  private writeToDisk(): void {
    const diff: Record<string, unknown> = {}
    for (const key of Object.keys(this.config) as BootConfigKey[]) {
      if (this.config[key] !== DefaultBootConfig[key]) {
        diff[key] = this.config[key]
      }
    }

    // The factory-reset slot is reconciled against disk instead of trusting
    // memory — see reconcileFactoryResetSlot for why.
    const marker = this.reconcileFactoryResetSlot()
    if (marker === null) {
      delete diff['temp.factory_reset']
    } else {
      diff['temp.factory_reset'] = marker
    }

    if (Object.keys(diff).length === 0) {
      // Delete the file so an all-defaults state leaves no stale non-default
      // config behind. Attempt the unlink directly rather than gating on
      // existsSync(): existsSync() folds ENOENT AND stat/permission errors into
      // `false`, which would mask a real-but-unreadable file and let this
      // "succeed" while stale config stays on disk. Tolerate only ENOENT
      // (already gone = the desired state); propagate everything else.
      try {
        fs.unlinkSync(this.filePath)
        logger.debug('Boot config file removed (all values are defaults)')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
      return
    }

    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const content = JSON.stringify(diff, null, 2)
    const tempPath = `${this.filePath}.tmp`

    fs.writeFileSync(tempPath, content, 'utf-8')
    fs.renameSync(tempPath, this.filePath)
    logger.debug(`Boot config saved to ${this.filePath}`)
  }

  /**
   * Decide what the `temp.factory_reset` slot of the next write should hold.
   *
   * boot-config.json is one file shared by every instance (dev and packaged),
   * and every write is whole-file last-writer-wins — so an instance that
   * loaded the file while ANOTHER instance's wipe marker was staged holds a
   * copy of that marker in memory, and its later writes would either
   * resurrect a marker the owner already consumed (arming a second wipe of
   * freshly created data) or erase a marker the owner has not consumed yet
   * (silently dropping the reset). Both are wrong, and both are fixed the
   * same way: never write a foreign marker from memory.
   *
   * Rule — memory is authoritative for the slot only when the slot is OURS:
   * the in-memory marker targets this instance's userData (we just staged or
   * re-armed it), or the on-disk marker does (we just consumed it and are
   * clearing the slot). In every other case whatever is currently on disk is
   * a foreign instance's business and is passed through unchanged.
   */
  private reconcileFactoryResetSlot(): BootConfigSchema['temp.factory_reset'] {
    const memory = this.config['temp.factory_reset']
    const disk = this.readFactoryResetFromDisk()
    if (JSON.stringify(memory ?? null) === JSON.stringify(disk ?? null)) return memory

    const self = this.currentUserDataPath()
    if (self !== null && (memory?.userDataPath === self || disk?.userDataPath === self)) {
      return memory
    }
    logger.info('Preserving a foreign factory-reset marker across a boot config write', {
      diskMarkerPath: disk?.userDataPath ?? null
    })
    return disk
  }

  /**
   * Fresh read of the on-disk `temp.factory_reset` value. Anything that
   * cannot be read, parsed, or validated counts as "no marker" — identical
   * to how loadSync treats the same states.
   */
  private readFactoryResetFromDisk(): BootConfigSchema['temp.factory_reset'] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      const result = bootConfigSchema.shape['temp.factory_reset'].safeParse(
        (parsed as Record<string, unknown>)['temp.factory_reset']
      )
      return result.success ? result.data : null
    } catch {
      return null
    }
  }

  /**
   * This instance's userData path — the ownership identity for the
   * factory-reset slot. Null before Electron has one (never the case for the
   * write paths that matter: the gate and the request both run after userData
   * resolution); null means "not provably ours", so disk wins.
   */
  private currentUserDataPath(): string | null {
    try {
      return app.getPath('userData')
    } catch {
      return null
    }
  }

  /**
   * Merge loaded config with defaults to handle new/missing keys, validating
   * every present value against the zod schema. Unknown keys are dropped;
   * invalid values fall back to defaults and are reported via `invalidKeys`
   * (or `invalidRoot` when the file root is not an object) so the caller can
   * surface a validation_error instead of silently adopting corrupt data.
   * No deep merge needed — flat key-value map with direct assignment.
   */
  private mergeDefaults(loaded: unknown): {
    config: BootConfigSchema
    invalidKeys: BootConfigKey[]
    invalidRoot: boolean
  } {
    if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) {
      return { config: { ...DefaultBootConfig }, invalidKeys: [], invalidRoot: true }
    }

    const config = { ...DefaultBootConfig }
    const invalidKeys: BootConfigKey[] = []
    const loadedRecord = loaded as Record<string, unknown>

    for (const key of Object.keys(config) as BootConfigKey[]) {
      if (!(key in loadedRecord)) continue
      const parsed = bootConfigSchema.shape[key].safeParse(loadedRecord[key])
      if (parsed.success) {
        ;(config as Record<string, unknown>)[key] = parsed.data
      } else {
        invalidKeys.push(key)
      }
    }

    return { config, invalidKeys, invalidRoot: false }
  }
}

export const bootConfigService = new BootConfigService()
