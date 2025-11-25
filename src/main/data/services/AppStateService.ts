import { dbService } from '@data/db/DbService'
import { appStateTable } from '@data/db/schemas/appState'
import { loggerService } from '@logger'
import { eq } from 'drizzle-orm'

const logger = loggerService.withContext('AppStateService')

/**
 * Service for managing application state in the database.
 * Provides key-value storage for persisting UI state like tabs, window positions, etc.
 */
export class AppStateService {
  private static instance: AppStateService

  private constructor() {}

  public static getInstance(): AppStateService {
    if (!AppStateService.instance) {
      AppStateService.instance = new AppStateService()
    }
    return AppStateService.instance
  }

  /**
   * Get app state by key
   * @param key - The state key to retrieve
   * @returns The stored value or null if not found
   */
  async getState<T = unknown>(key: string): Promise<T | null> {
    try {
      const db = dbService.getDb()
      const result = await db.select().from(appStateTable).where(eq(appStateTable.key, key)).limit(1)

      if (result.length === 0) {
        logger.debug('App state not found', { key })
        return null
      }

      logger.debug('Retrieved app state', { key })
      return result[0].value as T
    } catch (error) {
      logger.error('Failed to get app state', error as Error, { key })
      throw error
    }
  }

  /**
   * Save app state by key (upsert)
   * @param key - The state key
   * @param value - The value to store (will be JSON serialized)
   * @param description - Optional description of what this state stores
   */
  async setState<T = unknown>(key: string, value: T, description?: string): Promise<void> {
    try {
      const db = dbService.getDb()

      await db
        .insert(appStateTable)
        .values({
          key,
          value: value as any,
          description
        })
        .onConflictDoUpdate({
          target: appStateTable.key,
          set: {
            value: value as any,
            description,
            updatedAt: Date.now()
          }
        })

      logger.debug('Saved app state', { key })
    } catch (error) {
      logger.error('Failed to save app state', error as Error, { key })
      throw error
    }
  }

  /**
   * Delete app state by key
   * @param key - The state key to delete
   * @returns true if deleted, false if not found
   */
  async deleteState(key: string): Promise<boolean> {
    try {
      const db = dbService.getDb()
      const result = await db.delete(appStateTable).where(eq(appStateTable.key, key))

      const deleted = result.rowsAffected > 0
      logger.debug('Deleted app state', { key, deleted })
      return deleted
    } catch (error) {
      logger.error('Failed to delete app state', error as Error, { key })
      throw error
    }
  }
}

export const appStateService = AppStateService.getInstance()
