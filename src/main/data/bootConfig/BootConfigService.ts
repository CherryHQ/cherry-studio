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
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'
import { app } from 'electron'

import type { BootConfigLoadError } from './types'

const logger = loggerService.withContext('BootConfigService')

/** Debounce delay for saving config (ms) */
const SAVE_DEBOUNCE_MS = 500

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
  private listeners = new Map<BootConfigKey, Set<BootConfigChangeListener>>()
  private loadError: BootConfigLoadError | null = null

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'boot-config.json')
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
   */
  public set<K extends BootConfigKey>(key: K, value: BootConfigSchema[K]): void {
    const previousValue = this.config[key]
    this.config[key] = value
    this.scheduleSave()
    this.notifyListeners(key, value, previousValue)
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
   * Cancel debounce timer and save immediately.
   */
  public flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.saveSync()
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
        const config = this.mergeDefaults(parsed)
        logger.info(`Boot config loaded from ${this.filePath}`)
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
      this.saveSync()
      this.saveTimer = null
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Synchronously save config to file (atomic write via temp file + rename).
   * Only writes keys that differ from defaults. Deletes file if all values are defaults.
   */
  private saveSync(): void {
    try {
      const diff: Record<string, unknown> = {}
      for (const key of Object.keys(this.config) as BootConfigKey[]) {
        if (this.config[key] !== DefaultBootConfig[key]) {
          diff[key] = this.config[key]
        }
      }

      if (Object.keys(diff).length === 0) {
        if (fs.existsSync(this.filePath)) {
          fs.unlinkSync(this.filePath)
          logger.debug('Boot config file removed (all values are defaults)')
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
    } catch (error) {
      logger.error(`Failed to save boot config to ${this.filePath}`, error as Error)
    }
  }

  /**
   * Merge loaded config with defaults to handle new/missing keys.
   * No deep merge needed — flat key-value map with direct assignment.
   */
  private mergeDefaults(loaded: unknown): BootConfigSchema {
    if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) {
      return { ...DefaultBootConfig }
    }

    const result = { ...DefaultBootConfig }
    const loadedRecord = loaded as Record<string, unknown>

    for (const key of Object.keys(result) as BootConfigKey[]) {
      if (key in loadedRecord) {
        ;(result as Record<string, unknown>)[key] = loadedRecord[key]
      }
    }

    return result
  }
}

export const bootConfigService = new BootConfigService()
